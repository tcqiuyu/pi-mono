/**
 * Plan-Execute-Reflect orchestrator.
 *
 * Runs a structured plan by executing each step in an isolated agentLoop context,
 * reflecting after each step, and optionally replanning remaining steps.
 */

import { EventStream, type UserMessage } from "@mariozechner/pi-ai";
import { agentLoop } from "../agent-loop.js";
import type { Lesson } from "../memory/types.js";
import type { AgentContext, AgentMessage, StreamFn } from "../types.js";
import type { Plan, PlanExecuteConfig, PlanExecuteEvent, PlanStep, ReflectionResult } from "./types.js";

/**
 * Execute a plan step-by-step, with reflection and optional replanning after each step.
 *
 * Each step runs in an isolated context (fresh messages, step-specific system prompt).
 * The orchestrator forwards all AgentEvents from each step to the parent stream.
 */
export function planExecuteLoop(
	plan: Plan,
	config: PlanExecuteConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<PlanExecuteEvent, Plan> {
	const stream = new EventStream<PlanExecuteEvent, Plan>(
		(event) => event.type === "plan_end",
		(event) => (event.type === "plan_end" ? event.plan : plan),
	);

	runPlanLoop(plan, config, signal, streamFn, stream).catch(() => {
		// If we fail, end the stream with current plan state
		stream.push({ type: "plan_end", plan, lessons: [] });
		stream.end(plan);
	});

	return stream;
}

async function runPlanLoop(
	plan: Plan,
	config: PlanExecuteConfig,
	signal: AbortSignal | undefined,
	streamFn: StreamFn | undefined,
	stream: EventStream<PlanExecuteEvent, Plan>,
): Promise<void> {
	const allLessons: Lesson[] = [];
	const previousSummaries: string[] = [];

	stream.push({ type: "plan_start", plan });

	for (let i = 0; i < plan.steps.length; i++) {
		if (signal?.aborted) {
			markRemainingSkipped(plan, i);
			break;
		}

		const step = plan.steps[i];
		if (step.status !== "pending") continue;

		// Check for user interruption between steps
		const steering = await config.getSteeringMessages?.();
		if (steering && steering.length > 0) {
			step.status = "failed";
			step.result = "Interrupted by user.";
			markRemainingSkipped(plan, i + 1);
			break;
		}

		// --- Execute step ---
		step.status = "in_progress";
		stream.push({ type: "step_start", step, stepIndex: i });

		const relevantLessons = (await config.findRelevantLessons?.(step)) ?? [];
		const systemPrompt = config.buildStepSystemPrompt(plan, step, previousSummaries, relevantLessons);

		const stepContext: AgentContext = {
			systemPrompt,
			messages: [],
			tools: config.stepTools,
		};

		const prompt: UserMessage = {
			role: "user",
			content: step.description,
			timestamp: Date.now(),
		};

		const stepConfig = {
			...config,
			getSteeringMessages: config.getSteeringMessages,
			getFollowUpMessages: undefined,
		};

		const stepMessages: AgentMessage[] = [];

		try {
			const stepStream = agentLoop([prompt], stepContext, stepConfig, signal, streamFn);

			for await (const event of stepStream) {
				// Forward agent events to parent stream
				stream.push(event);

				// Collect messages for reflection
				if (event.type === "message_end") {
					stepMessages.push(event.message);
				}
			}

			const result = await stepStream.result();
			stepMessages.push(...result.filter((m) => !stepMessages.includes(m)));

			step.status = "completed";
		} catch (err) {
			step.status = "failed";
			step.result = err instanceof Error ? err.message : String(err);
		}

		const stepIndex = i;
		stream.push({ type: "step_end", step, stepIndex, summary: step.result ?? "" });

		// --- Reflection phase ---
		stream.push({ type: "reflection_start", stepIndex });

		let reflection: ReflectionResult;
		try {
			reflection = await runReflection(plan, step, stepMessages, config, signal, streamFn);
		} catch {
			// Reflection failure is non-fatal — use a default result
			reflection = {
				stepSummary: step.result ?? `Step ${stepIndex + 1} ${step.status}.`,
				lessonsLearned: [],
			};
		}

		stream.push({ type: "reflection_end", stepIndex, result: reflection });

		// Apply reflection results
		step.result = reflection.stepSummary;
		previousSummaries.push(`Step ${stepIndex + 1}: ${reflection.stepSummary}`);

		// Save lessons
		for (const lessonData of reflection.lessonsLearned) {
			if (config.lessonStore) {
				const saved = await config.lessonStore.save({
					content: lessonData.content,
					source: lessonData.source,
					status: "draft",
					tags: lessonData.tags,
				});
				allLessons.push(saved);
			}
		}

		// Replan if reflection provided updated steps
		if (reflection.updatedSteps) {
			const previousSteps = plan.steps.slice(i + 1);
			plan.steps = [...plan.steps.slice(0, i + 1), ...reflection.updatedSteps];
			stream.push({ type: "replan", previousSteps, newSteps: reflection.updatedSteps });
		}

		// Early termination
		if (reflection.shouldStop) {
			markRemainingSkipped(plan, i + 1);
			break;
		}
	}

	stream.push({ type: "plan_end", plan, lessons: allLessons });
	stream.end(plan);
}

/**
 * Run a reflection LLM call (no tools, pure reasoning) to assess step results.
 */
async function runReflection(
	plan: Plan,
	step: PlanStep,
	stepMessages: AgentMessage[],
	config: PlanExecuteConfig,
	signal: AbortSignal | undefined,
	streamFn: StreamFn | undefined,
): Promise<ReflectionResult> {
	const systemPrompt = config.buildReflectionSystemPrompt(plan, step, stepMessages);

	const reflectionContext: AgentContext = {
		systemPrompt,
		messages: [],
		tools: [], // No tools — pure reasoning
	};

	const prompt: UserMessage = {
		role: "user",
		content: "Reflect on the step execution above and provide your assessment.",
		timestamp: Date.now(),
	};

	const reflectionConfig = {
		...config,
		tools: undefined,
		getSteeringMessages: undefined,
		getFollowUpMessages: undefined,
	};

	const reflectionStream = agentLoop([prompt], reflectionContext, reflectionConfig, signal, streamFn);

	let assistantMessage: AgentMessage | undefined;
	for await (const event of reflectionStream) {
		if (event.type === "message_end" && event.message.role === "assistant") {
			assistantMessage = event.message;
		}
	}

	if (!assistantMessage || assistantMessage.role !== "assistant") {
		return { stepSummary: step.result ?? "Step completed.", lessonsLearned: [] };
	}

	return config.parseReflection(assistantMessage);
}

function markRemainingSkipped(plan: Plan, fromIndex: number): void {
	for (let j = fromIndex; j < plan.steps.length; j++) {
		if (plan.steps[j].status === "pending") {
			plan.steps[j].status = "skipped";
		}
	}
}
