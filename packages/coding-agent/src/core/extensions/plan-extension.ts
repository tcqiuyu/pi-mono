/**
 * Plan extension — Plan-Execute-Reflect orchestrator integration.
 *
 * Registers tool: create_plan
 * Registers command: /plan <goal>
 * On agent_end: detects pending plan and sends next step as follow-up
 */

import {
	findRelevantLessons,
	formatLessonsForContext,
	type LessonStore,
	type Plan,
	type PlanStep,
} from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ExtensionFactory } from "./types.js";

const PLAN_SYSTEM_PROMPT = `For complex multi-step tasks, use the create_plan tool to create a structured execution plan.
Suitable scenarios: multiple file modifications, ordered steps with dependencies, tasks requiring coordination.
Simple single-step tasks should be executed directly without a plan.`;

export function createPlanExtension(lessonStore?: LessonStore): ExtensionFactory {
	return (pi) => {
		let pendingPlan: Plan | null = null;
		let currentStepIndex = -1;

		// --- create_plan tool ---

		pi.registerTool({
			name: "create_plan",
			label: "Create Plan",
			description:
				"Create a structured execution plan for complex multi-step tasks. Each step will be executed sequentially. Use this for tasks involving multiple file modifications, ordered steps, or dependency chains.",
			parameters: Type.Object({
				goal: Type.String({ description: "The overall goal of the plan." }),
				steps: Type.Array(Type.String(), {
					description: "Ordered list of step descriptions. Each step should be self-contained and actionable.",
					minItems: 2,
				}),
			}),
			async execute(_toolCallId, params) {
				const plan: Plan = {
					goal: params.goal,
					steps: params.steps.map((desc, i) => ({
						id: `step-${i + 1}`,
						description: desc,
						status: "pending" as const,
					})),
				};
				pendingPlan = plan;
				currentStepIndex = -1;

				const stepList = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n");
				const text = `Plan created with ${plan.steps.length} steps:\n\n${stepList}\n\nI will execute each step sequentially.`;

				return {
					content: [{ type: "text", text }],
					details: plan,
				};
			},
		});

		// --- before_agent_start: inject plan instructions ---

		pi.on("before_agent_start", async (event) => {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${PLAN_SYSTEM_PROMPT}`,
			};
		});

		// --- agent_end: advance to next plan step ---

		pi.on("agent_end", async () => {
			if (!pendingPlan) return;

			const plan = pendingPlan;

			// Mark current step as completed (if we were executing one)
			if (currentStepIndex >= 0 && currentStepIndex < plan.steps.length) {
				plan.steps[currentStepIndex].status = "completed";
				plan.steps[currentStepIndex].result = `Step ${currentStepIndex + 1} executed.`;

				pi.sendMessage(
					{
						customType: "plan_status",
						content: `Completed step ${currentStepIndex + 1}/${plan.steps.length}: ${plan.steps[currentStepIndex].description}`,
						display: true,
					},
					{ triggerTurn: false },
				);
			}

			// Find next pending step
			currentStepIndex++;
			if (currentStepIndex >= plan.steps.length) {
				// All steps done
				const completedCount = plan.steps.filter((s) => s.status === "completed").length;
				pi.sendMessage(
					{
						customType: "plan_status",
						content: `Plan execution complete. ${completedCount}/${plan.steps.length} steps completed.`,
						display: true,
					},
					{ triggerTurn: false },
				);
				pendingPlan = null;
				currentStepIndex = -1;
				return;
			}

			const step = plan.steps[currentStepIndex];
			step.status = "in_progress";

			// Build context-enriched prompt for this step
			const previousSummaries = plan.steps
				.slice(0, currentStepIndex)
				.filter((s) => s.result)
				.map((s, idx) => `Step ${idx + 1}: ${s.result}`);

			let relevantLessonsText = "";
			if (lessonStore) {
				const allLessons = await lessonStore.load();
				const relevant = findRelevantLessons(allLessons, step.description, 3);
				if (relevant.length > 0) {
					relevantLessonsText = `\n\n${formatLessonsForContext(relevant)}`;
				}
			}

			const stepPrompt = buildStepPrompt(plan, step, currentStepIndex, previousSummaries, relevantLessonsText);

			// Send as follow-up so it executes after the current agent loop completes
			pi.sendUserMessage(stepPrompt, { deliverAs: "followUp" });
		});

		// --- /plan command ---

		pi.registerCommand("plan", {
			description: "Create and execute a plan for a complex task. Usage: /plan <goal description>",
			async handler(args) {
				const goal = args.trim();
				if (!goal) {
					return;
				}

				pi.sendUserMessage(`Create a plan for the following goal using the create_plan tool:\n\n${goal}`);
			},
		});
	};
}

function buildStepPrompt(
	plan: Plan,
	step: PlanStep,
	stepIndex: number,
	previousSummaries: string[],
	relevantLessonsText: string,
): string {
	const totalSteps = plan.steps.length;
	const stepList = plan.steps
		.map((s, i) => {
			const marker = i === stepIndex ? "→" : s.status === "completed" ? "✓" : " ";
			return `${marker} ${i + 1}. [${s.status}] ${s.description}`;
		})
		.join("\n");

	const prevText = previousSummaries.length > 0 ? `\n\n## Previous Steps\n${previousSummaries.join("\n")}` : "";

	return `You are executing step ${stepIndex + 1} of ${totalSteps} in a plan.

## Overall Goal
${plan.goal}

## Plan
${stepList}

## Current Step
${step.description}${prevText}${relevantLessonsText}

Focus on completing this step only. Do not proceed to the next step.`;
}
