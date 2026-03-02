import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Lesson, LessonStore } from "./types.js";

/** Internal record stored in JSONL — includes soft-delete marker. */
interface LessonRecord extends Lesson {
	deleted?: boolean;
}

let idCounter = 0;

function generateId(): string {
	return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append-only JSONL lesson store with soft-delete.
 *
 * Each line is a JSON record. On `load()`, records are deduplicated by id
 * (last write wins) and deleted records are filtered out.
 */
export class JsonlLessonStore implements LessonStore {
	constructor(private readonly filePath: string) {}

	async load(): Promise<Lesson[]> {
		const records = await this.readRecords();
		return records.filter((r) => !r.deleted).map(stripDeleted);
	}

	async save(lesson: Omit<Lesson, "id" | "createdAt" | "updatedAt">): Promise<Lesson> {
		const now = Date.now();
		const record: LessonRecord = {
			...lesson,
			id: generateId(),
			createdAt: now,
			updatedAt: now,
		};
		await this.appendRecord(record);
		return stripDeleted(record);
	}

	async confirm(id: string): Promise<boolean> {
		const records = await this.readRecords();
		const existing = records.find((r) => r.id === id && !r.deleted);
		if (!existing) return false;
		if (existing.status === "confirmed") return true;

		const updated: LessonRecord = {
			...existing,
			status: "confirmed",
			updatedAt: Date.now(),
		};
		await this.appendRecord(updated);
		return true;
	}

	async remove(id: string): Promise<boolean> {
		const records = await this.readRecords();
		const existing = records.find((r) => r.id === id && !r.deleted);
		if (!existing) return false;

		const deleted: LessonRecord = {
			...existing,
			deleted: true,
			updatedAt: Date.now(),
		};
		await this.appendRecord(deleted);
		return true;
	}

	async list(filter?: { status?: Lesson["status"]; tags?: string[] }): Promise<Lesson[]> {
		let lessons = await this.load();
		if (filter?.status) {
			lessons = lessons.filter((l) => l.status === filter.status);
		}
		if (filter?.tags && filter.tags.length > 0) {
			const filterTags = new Set(filter.tags.map((t) => t.toLowerCase()));
			lessons = lessons.filter((l) => l.tags.some((t) => filterTags.has(t.toLowerCase())));
		}
		return lessons;
	}

	private async readRecords(): Promise<LessonRecord[]> {
		let content: string;
		try {
			content = await readFile(this.filePath, "utf-8");
		} catch {
			return [];
		}

		const byId = new Map<string, LessonRecord>();
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const record = JSON.parse(trimmed) as LessonRecord;
				if (record.id) {
					byId.set(record.id, record);
				}
			} catch {
				// Skip malformed lines
			}
		}
		return Array.from(byId.values());
	}

	private async appendRecord(record: LessonRecord): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf-8");
	}
}

function stripDeleted(record: LessonRecord): Lesson {
	const { deleted: _, ...lesson } = record;
	return lesson;
}
