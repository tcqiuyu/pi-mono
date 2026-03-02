/**
 * Memory extension — persists lessons learned across sessions.
 *
 * Registers tools: save_lesson, list_lessons, delete_lesson
 * Registers command: /lessons
 * Injects relevant lessons into context via before_agent_start
 */

import { join } from "node:path";
import type { LessonStore } from "@mariozechner/pi-agent-core";
import { findRelevantLessons, formatLessonsForContext, JsonlLessonStore } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ExtensionFactory } from "./types.js";

const MEMORY_SYSTEM_PROMPT = `You have an experience memory system. Use the save_lesson tool to record lessons when:
- The user corrects your approach (source: user_correction)
- A tool failure reveals a reusable lesson (source: tool_failure)
- You discover an important pattern about the codebase (source: self_discovery)

Lessons start as "draft" — the user can confirm them with /lessons confirm <id>.
Only save truly reusable insights, not task-specific details.`;

export function createMemoryExtension(cwd: string): ExtensionFactory {
	return (pi) => {
		const storePath = join(cwd, ".pi", "lessons.jsonl");
		const store: LessonStore = new JsonlLessonStore(storePath);

		// --- Tools ---

		pi.registerTool({
			name: "save_lesson",
			label: "Save Lesson",
			description:
				"Save a lesson learned from experience. Use when: the user corrects you, a tool failure reveals a reusable insight, or you discover an important codebase pattern.",
			parameters: Type.Object({
				content: Type.String({ description: "The lesson content — a concise, reusable insight." }),
				source: Type.Union(
					[Type.Literal("user_correction"), Type.Literal("tool_failure"), Type.Literal("self_discovery")],
					{ description: "How the lesson was learned." },
				),
				tags: Type.Array(Type.String(), {
					description: "Keywords for retrieval (e.g., language, tool, pattern).",
				}),
			}),
			async execute(_toolCallId, params) {
				const lesson = await store.save({
					content: params.content,
					source: params.source,
					status: "draft",
					tags: params.tags,
				});
				return {
					content: [{ type: "text", text: `Lesson saved (id: ${lesson.id}, status: draft).` }],
					details: lesson,
				};
			},
		});

		pi.registerTool({
			name: "list_lessons",
			label: "List Lessons",
			description: "List all stored lessons. Optionally filter by status or tags.",
			parameters: Type.Object({
				status: Type.Optional(
					Type.Union([Type.Literal("draft"), Type.Literal("confirmed")], {
						description: "Filter by status.",
					}),
				),
				tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags (match any)." })),
			}),
			async execute(_toolCallId, params) {
				const lessons = await store.list({
					status: params.status,
					tags: params.tags,
				});
				if (lessons.length === 0) {
					return { content: [{ type: "text", text: "No lessons found." }], details: [] };
				}
				const text = lessons.map((l) => `[${l.id}] (${l.status}) [${l.tags.join(", ")}] ${l.content}`).join("\n");
				return { content: [{ type: "text", text }], details: lessons };
			},
		});

		pi.registerTool({
			name: "delete_lesson",
			label: "Delete Lesson",
			description: "Delete a stored lesson by its ID.",
			parameters: Type.Object({
				id: Type.String({ description: "The lesson ID to delete." }),
			}),
			async execute(_toolCallId, params) {
				const removed = await store.remove(params.id);
				const text = removed ? `Lesson ${params.id} deleted.` : `Lesson ${params.id} not found.`;
				return { content: [{ type: "text", text }], details: { removed } };
			},
		});

		// --- before_agent_start: inject relevant lessons ---

		pi.on("before_agent_start", async (event) => {
			const allLessons = await store.load();
			if (allLessons.length === 0) return;

			const relevant = findRelevantLessons(allLessons, event.prompt, 5);
			if (relevant.length === 0) return;

			const context = formatLessonsForContext(relevant);
			return {
				systemPrompt: `${event.systemPrompt}\n\n${MEMORY_SYSTEM_PROMPT}\n\n${context}`,
			};
		});

		// --- /lessons command ---

		pi.registerCommand("lessons", {
			description: "Manage experience lessons: list, confirm <id>, delete <id>",
			async handler(args, ctx) {
				const parts = args.trim().split(/\s+/);
				const subcommand = parts[0] || "list";
				const id = parts[1];

				if (subcommand === "list" || subcommand === "") {
					const lessons = await store.load();
					if (lessons.length === 0) {
						ctx.ui.notify("No lessons stored.", "info");
						return;
					}
					const lines = lessons.map((l) => `[${l.id}] (${l.status}) [${l.tags.join(", ")}] ${l.content}`);
					pi.sendMessage(
						{ customType: "lessons", content: lines.join("\n"), display: true },
						{ triggerTurn: false },
					);
				} else if (subcommand === "confirm") {
					if (!id) {
						ctx.ui.notify("Usage: /lessons confirm <id>", "warning");
						return;
					}
					const confirmed = await store.confirm(id);
					ctx.ui.notify(
						confirmed ? `Lesson ${id} confirmed.` : `Lesson ${id} not found.`,
						confirmed ? "info" : "warning",
					);
				} else if (subcommand === "delete") {
					if (!id) {
						ctx.ui.notify("Usage: /lessons delete <id>", "warning");
						return;
					}
					const removed = await store.remove(id);
					ctx.ui.notify(
						removed ? `Lesson ${id} deleted.` : `Lesson ${id} not found.`,
						removed ? "info" : "warning",
					);
				} else {
					ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use list, confirm, or delete.`, "warning");
				}
			},
		});
	};
}

export type { LessonStore };
