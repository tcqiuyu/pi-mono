import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Lesson } from "../memory/types.js";
import type { AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../types.js";

/** A single step in an execution plan. */
export interface PlanStep {
	id: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
	/** Summary of what happened after execution. */
	result?: string;
}

/** A structured execution plan. */
export interface Plan {
	goal: string;
	steps: PlanStep[];
}

/** Result of reflecting on a completed step. */
export interface ReflectionResult {
	/** Short summary of what the step accomplished. */
	stepSummary: string;
	/** Lessons extracted from this step's execution. */
	lessonsLearned: Array<{
		content: string;
		source: Lesson["source"];
		tags: string[];
	}>;
	/** Revised remaining steps, or undefined to keep current plan. */
	updatedSteps?: PlanStep[];
	/** Whether to stop executing the plan early. */
	shouldStop?: boolean;
}

/** Configuration for the plan-execute loop orchestrator. */
export interface PlanExecuteConfig extends Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages"> {
	/** Build an isolated system prompt for each step's executor. */
	buildStepSystemPrompt: (
		plan: Plan,
		step: PlanStep,
		previousSummaries: string[],
		relevantLessons: Lesson[],
	) => string;

	/** Build a system prompt for the reflection phase. */
	buildReflectionSystemPrompt: (plan: Plan, step: PlanStep, stepMessages: AgentMessage[]) => string;

	/** Parse the reflection LLM response into a structured result. */
	parseReflection: (response: AssistantMessage) => ReflectionResult;

	/** Optional lesson store for persisting discovered lessons. */
	lessonStore?: import("../memory/types.js").LessonStore;

	/** Optional function to retrieve lessons relevant to a step. */
	findRelevantLessons?: (step: PlanStep) => Promise<Lesson[]>;

	/** Tools available to each step's executor (defaults to config.tools). */
	stepTools?: AgentTool<any>[];

	/** Check for user interruption during orchestration. */
	getSteeringMessages?: () => Promise<AgentMessage[]>;
}

/** Events emitted by the plan-execute orchestrator. */
export type PlanExecuteEvent =
	| AgentEvent
	| { type: "plan_start"; plan: Plan }
	| { type: "step_start"; step: PlanStep; stepIndex: number }
	| { type: "step_end"; step: PlanStep; stepIndex: number; summary: string }
	| { type: "reflection_start"; stepIndex: number }
	| { type: "reflection_end"; stepIndex: number; result: ReflectionResult }
	| { type: "replan"; previousSteps: PlanStep[]; newSteps: PlanStep[] }
	| { type: "plan_end"; plan: Plan; lessons: Lesson[] };
