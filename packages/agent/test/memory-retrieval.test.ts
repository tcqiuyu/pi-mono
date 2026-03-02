import { describe, expect, it } from "vitest";
import { findRelevantLessons, formatLessonsForContext } from "../src/memory/retrieval.js";
import type { Lesson } from "../src/memory/types.js";

function createLesson(overrides: Partial<Lesson> = {}): Lesson {
	return {
		id: "test-id",
		content: "Default lesson content.",
		source: "self_discovery",
		status: "draft",
		tags: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

describe("findRelevantLessons", () => {
	it("should return empty array for empty lessons", () => {
		const result = findRelevantLessons([], "typescript types");
		expect(result).toEqual([]);
	});

	it("should return empty array for empty query", () => {
		const lessons = [createLesson({ content: "Use strict mode.", tags: ["typescript"] })];
		const result = findRelevantLessons(lessons, "");
		expect(result).toEqual([]);
	});

	it("should match by content tokens", () => {
		const lessons = [
			createLesson({ id: "1", content: "Always use typescript strict mode.", tags: [] }),
			createLesson({ id: "2", content: "Python prefers snake_case.", tags: [] }),
		];

		const result = findRelevantLessons(lessons, "typescript strict");
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("1");
	});

	it("should match by tags with higher weight", () => {
		const lessons = [
			createLesson({ id: "1", content: "Some generic lesson.", tags: ["typescript"] }),
			createLesson({ id: "2", content: "TypeScript lesson content.", tags: [] }),
		];

		const result = findRelevantLessons(lessons, "typescript");
		// Tag match (3) > content match (1), so lesson 1 should come first
		expect(result[0].id).toBe("1");
	});

	it("should boost confirmed lessons", () => {
		const lessons = [
			createLesson({ id: "1", content: "Use typescript strict mode.", status: "draft", tags: [] }),
			createLesson({ id: "2", content: "Use typescript strict mode.", status: "confirmed", tags: [] }),
		];

		const result = findRelevantLessons(lessons, "typescript strict");
		// Confirmed gets 1.5x boost
		expect(result[0].id).toBe("2");
	});

	it("should respect maxCount", () => {
		const lessons = Array.from({ length: 10 }, (_, i) =>
			createLesson({ id: `${i}`, content: `Lesson about testing ${i}.`, tags: ["testing"] }),
		);

		const result = findRelevantLessons(lessons, "testing", 3);
		expect(result).toHaveLength(3);
	});

	it("should filter out zero-score lessons", () => {
		const lessons = [createLesson({ id: "1", content: "Completely unrelated.", tags: ["cooking"] })];

		const result = findRelevantLessons(lessons, "typescript types");
		expect(result).toHaveLength(0);
	});
});

describe("formatLessonsForContext", () => {
	it("should return empty string for empty lessons", () => {
		expect(formatLessonsForContext([])).toBe("");
	});

	it("should format lessons with status and tags", () => {
		const lessons = [
			createLesson({
				content: "Always check types.",
				status: "confirmed",
				tags: ["typescript"],
			}),
			createLesson({
				content: "Use strict mode.",
				status: "draft",
				tags: [],
			}),
		];

		const result = formatLessonsForContext(lessons);
		expect(result).toContain("## Relevant Lessons");
		expect(result).toContain("[confirmed]");
		expect(result).toContain("[draft]");
		expect(result).toContain("Always check types.");
		expect(result).toContain("(typescript)");
	});
});
