import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { Lesson } from "../src/memory/types.js";
import { planExecuteLoop } from "../src/plan/plan-execute-loop.js";
import type { Plan, PlanExecuteConfig, PlanExecuteEvent, ReflectionResult } from "../src/plan/types.js";
import type { AgentMessage } from "../src/types.js";

// --- Test helpers ---

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function createPlan(steps: string[]): Plan {
	return {
		goal: "Test goal",
		steps: steps.map((desc, i) => ({
			id: `step-${i + 1}`,
			description: desc,
			status: "pending" as const,
		})),
	};
}

/**
 * Create a mock streamFn. Alternates between step execution (even calls)
 * and reflection (odd calls). Each test gets its own call counter.
 */
function createMockStreamFn(reflections?: ReflectionResult[]) {
	let callCount = 0;
	return () => {
		const idx = callCount++;
		const stream = new MockAssistantStream();
		const isReflection = idx % 2 === 1;

		let text: string;
		if (isReflection) {
			const reflIdx = Math.floor(idx / 2);
			const refl = reflections?.[reflIdx] ?? { stepSummary: `Step ${reflIdx + 1} done.`, lessonsLearned: [] };
			text = JSON.stringify(refl);
		} else {
			text = `Executed step ${Math.floor(idx / 2) + 1}.`;
		}

		queueMicrotask(() => {
			stream.push({ type: "done", reason: "stop", message: createAssistantMessage(text) });
		});
		return stream;
	};
}

function createConfig(overrides?: Partial<PlanExecuteConfig>): PlanExecuteConfig {
	return {
		model: createModel(),
		convertToLlm: identityConverter,
		buildStepSystemPrompt: () => "Execute the step.",
		buildReflectionSystemPrompt: () => "Reflect on the step.",
		parseReflection: (response) => {
			const c = response.content.find((c) => c.type === "text");
			if (c && c.type === "text") {
				try {
					return JSON.parse(c.text) as ReflectionResult;
				} catch {
					/* */
				}
			}
			return { stepSummary: "Done.", lessonsLearned: [] };
		},
		...overrides,
	};
}

// --- Tests ---

describe("planExecuteLoop", () => {
	it("should execute all steps in a plan", async () => {
		const plan = createPlan(["Step 1", "Step 2"]);
		const stream = planExecuteLoop(plan, createConfig(), undefined, createMockStreamFn());

		const events: PlanExecuteEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const result = await stream.result();
		expect(result.steps[0].status).toBe("completed");
		expect(result.steps[1].status).toBe("completed");

		const types = events.map((e) => e.type);
		expect(types).toContain("plan_start");
		expect(types).toContain("step_start");
		expect(types).toContain("step_end");
		expect(types).toContain("reflection_start");
		expect(types).toContain("reflection_end");
		expect(types).toContain("plan_end");
	}, 10000);

	it("should forward agent events from step execution", async () => {
		const plan = createPlan(["Step 1"]);
		const stream = planExecuteLoop(plan, createConfig(), undefined, createMockStreamFn());

		const events: PlanExecuteEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const agentEvents = events.filter((e) => e.type === "agent_start" || e.type === "agent_end");
		expect(agentEvents.length).toBeGreaterThan(0);
	}, 10000);

	it("should handle replan from reflection", async () => {
		const plan = createPlan(["Step 1", "Step 2", "Step 3"]);
		const reflections: ReflectionResult[] = [
			{
				stepSummary: "Step 1 done, adjusting plan.",
				lessonsLearned: [],
				updatedSteps: [{ id: "step-2-rev", description: "Revised step 2", status: "pending" }],
			},
			{ stepSummary: "Revised step 2 done.", lessonsLearned: [] },
		];

		const stream = planExecuteLoop(plan, createConfig(), undefined, createMockStreamFn(reflections));
		const events: PlanExecuteEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const replanEvents = events.filter((e) => e.type === "replan");
		expect(replanEvents).toHaveLength(1);

		const result = await stream.result();
		const completed = result.steps.filter((s) => s.status === "completed");
		expect(completed).toHaveLength(2);
	}, 10000);

	it("should handle shouldStop from reflection", async () => {
		const plan = createPlan(["Step 1", "Step 2", "Step 3"]);
		const reflections: ReflectionResult[] = [
			{ stepSummary: "Step 1 done, stopping.", lessonsLearned: [], shouldStop: true },
		];

		const stream = planExecuteLoop(plan, createConfig(), undefined, createMockStreamFn(reflections));
		for await (const _ of stream) {
			/* consume */
		}

		const result = await stream.result();
		expect(result.steps[0].status).toBe("completed");
		expect(result.steps[1].status).toBe("skipped");
		expect(result.steps[2].status).toBe("skipped");
	}, 10000);

	it("should save lessons from reflection", async () => {
		const plan = createPlan(["Step 1"]);
		const savedLessons: Lesson[] = [];
		const reflections: ReflectionResult[] = [
			{
				stepSummary: "Done.",
				lessonsLearned: [{ content: "Check file encoding.", source: "self_discovery", tags: ["encoding"] }],
			},
		];

		const config = createConfig({
			lessonStore: {
				load: async () => [],
				save: async (lesson) => {
					const saved: Lesson = {
						...lesson,
						id: `l-${savedLessons.length}`,
						createdAt: Date.now(),
						updatedAt: Date.now(),
					};
					savedLessons.push(saved);
					return saved;
				},
				confirm: async () => true,
				remove: async () => true,
				list: async () => [],
			},
		});

		const stream = planExecuteLoop(plan, config, undefined, createMockStreamFn(reflections));
		const events: PlanExecuteEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(savedLessons).toHaveLength(1);
		expect(savedLessons[0].content).toBe("Check file encoding.");

		const planEnd = events.find((e) => e.type === "plan_end");
		expect(planEnd).toBeDefined();
		if (planEnd && planEnd.type === "plan_end") {
			expect(planEnd.lessons).toHaveLength(1);
		}
	}, 10000);

	it("should skip all steps on abort", async () => {
		const plan = createPlan(["Step 1", "Step 2"]);
		const controller = new AbortController();
		controller.abort();

		const stream = planExecuteLoop(plan, createConfig(), controller.signal, createMockStreamFn());
		for await (const _ of stream) {
			/* consume */
		}

		const result = await stream.result();
		expect(result.steps.every((s) => s.status === "skipped")).toBe(true);
	}, 10000);
});
