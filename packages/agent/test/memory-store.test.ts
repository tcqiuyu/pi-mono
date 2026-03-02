import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlLessonStore } from "../src/memory/jsonl-store.js";

describe("JsonlLessonStore", () => {
	let tempDir: string;
	let storePath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "memory-test-"));
		storePath = join(tempDir, "lessons.jsonl");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should save and load a lesson", async () => {
		const store = new JsonlLessonStore(storePath);

		const saved = await store.save({
			content: "Always check types before casting.",
			source: "user_correction",
			status: "draft",
			tags: ["typescript", "types"],
		});

		expect(saved.id).toBeDefined();
		expect(saved.content).toBe("Always check types before casting.");
		expect(saved.source).toBe("user_correction");
		expect(saved.status).toBe("draft");
		expect(saved.tags).toEqual(["typescript", "types"]);
		expect(saved.createdAt).toBeGreaterThan(0);
		expect(saved.updatedAt).toBeGreaterThan(0);

		const loaded = await store.load();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].content).toBe("Always check types before casting.");
	});

	it("should handle empty file", async () => {
		const store = new JsonlLessonStore(storePath);
		const loaded = await store.load();
		expect(loaded).toHaveLength(0);
	});

	it("should deduplicate by id (last write wins)", async () => {
		const store = new JsonlLessonStore(storePath);

		const saved = await store.save({
			content: "Original content.",
			source: "self_discovery",
			status: "draft",
			tags: ["test"],
		});

		// Confirm the lesson (writes a new record with the same id)
		await store.confirm(saved.id);

		const loaded = await store.load();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].status).toBe("confirmed");
	});

	it("should soft-delete a lesson", async () => {
		const store = new JsonlLessonStore(storePath);

		const saved = await store.save({
			content: "To be deleted.",
			source: "tool_failure",
			status: "draft",
			tags: ["cleanup"],
		});

		const removed = await store.remove(saved.id);
		expect(removed).toBe(true);

		const loaded = await store.load();
		expect(loaded).toHaveLength(0);
	});

	it("should return false when removing non-existent lesson", async () => {
		const store = new JsonlLessonStore(storePath);
		const removed = await store.remove("non-existent-id");
		expect(removed).toBe(false);
	});

	it("should return false when confirming non-existent lesson", async () => {
		const store = new JsonlLessonStore(storePath);
		const confirmed = await store.confirm("non-existent-id");
		expect(confirmed).toBe(false);
	});

	it("should filter by status", async () => {
		const store = new JsonlLessonStore(storePath);

		const lesson1 = await store.save({
			content: "Draft lesson.",
			source: "self_discovery",
			status: "draft",
			tags: ["test"],
		});

		await store.save({
			content: "Another draft.",
			source: "tool_failure",
			status: "draft",
			tags: ["test"],
		});

		await store.confirm(lesson1.id);

		const drafts = await store.list({ status: "draft" });
		expect(drafts).toHaveLength(1);
		expect(drafts[0].content).toBe("Another draft.");

		const confirmed = await store.list({ status: "confirmed" });
		expect(confirmed).toHaveLength(1);
		expect(confirmed[0].content).toBe("Draft lesson.");
	});

	it("should filter by tags", async () => {
		const store = new JsonlLessonStore(storePath);

		await store.save({
			content: "TypeScript lesson.",
			source: "self_discovery",
			status: "draft",
			tags: ["typescript"],
		});

		await store.save({
			content: "Python lesson.",
			source: "self_discovery",
			status: "draft",
			tags: ["python"],
		});

		const tsLessons = await store.list({ tags: ["typescript"] });
		expect(tsLessons).toHaveLength(1);
		expect(tsLessons[0].content).toBe("TypeScript lesson.");
	});

	it("should persist across store instances", async () => {
		const store1 = new JsonlLessonStore(storePath);
		await store1.save({
			content: "Persistent lesson.",
			source: "user_correction",
			status: "draft",
			tags: ["persistence"],
		});

		const store2 = new JsonlLessonStore(storePath);
		const loaded = await store2.load();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].content).toBe("Persistent lesson.");
	});

	it("should create directory if it does not exist", async () => {
		const nestedPath = join(tempDir, "nested", "dir", "lessons.jsonl");
		const store = new JsonlLessonStore(nestedPath);

		await store.save({
			content: "Nested lesson.",
			source: "self_discovery",
			status: "draft",
			tags: [],
		});

		const loaded = await store.load();
		expect(loaded).toHaveLength(1);
	});
});
