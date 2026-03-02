import type { Lesson } from "./types.js";

/**
 * Find lessons relevant to a query using keyword matching.
 * Confirmed lessons are weighted higher than drafts.
 */
export function findRelevantLessons(lessons: Lesson[], query: string, maxCount = 5): Lesson[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return [];

	const scored = lessons.map((lesson) => ({
		lesson,
		score: scoreLessonRelevance(lesson, queryTokens),
	}));

	return scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxCount)
		.map((s) => s.lesson);
}

/** Format lessons for injection into an LLM system/context prompt. */
export function formatLessonsForContext(lessons: Lesson[]): string {
	if (lessons.length === 0) return "";

	const lines = lessons.map((l, i) => {
		const status = l.status === "confirmed" ? "[confirmed]" : "[draft]";
		const tags = l.tags.length > 0 ? ` (${l.tags.join(", ")})` : "";
		return `${i + 1}. ${status}${tags} ${l.content}`;
	});

	return `## Relevant Lessons\n${lines.join("\n")}`;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[\s,.\-_:;!?()[\]{}'"]+/)
		.filter((t) => t.length > 1);
}

function scoreLessonRelevance(lesson: Lesson, queryTokens: string[]): number {
	const contentTokens = new Set(tokenize(lesson.content));
	const tagTokens = new Set(lesson.tags.map((t) => t.toLowerCase()));

	let score = 0;
	for (const token of queryTokens) {
		if (tagTokens.has(token)) {
			score += 3; // Tag match is worth more
		}
		if (contentTokens.has(token)) {
			score += 1;
		}
	}

	// Confirmed lessons get a 50% boost
	if (lesson.status === "confirmed") {
		score *= 1.5;
	}

	return score;
}
