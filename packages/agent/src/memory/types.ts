/** A lesson learned from experience — corrections, failures, or discoveries. */
export interface Lesson {
	id: string;
	content: string;
	source: "user_correction" | "tool_failure" | "self_discovery";
	status: "draft" | "confirmed";
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

/** Persistent store for lessons learned. */
export interface LessonStore {
	/** Load all active (non-deleted) lessons. */
	load(): Promise<Lesson[]>;

	/** Save a new lesson. Returns the created lesson with generated id and timestamps. */
	save(lesson: Omit<Lesson, "id" | "createdAt" | "updatedAt">): Promise<Lesson>;

	/** Confirm a draft lesson. Returns true if found and updated. */
	confirm(id: string): Promise<boolean>;

	/** Soft-delete a lesson. Returns true if found and deleted. */
	remove(id: string): Promise<boolean>;

	/** List lessons with optional filtering. */
	list(filter?: { status?: Lesson["status"]; tags?: string[] }): Promise<Lesson[]>;
}
