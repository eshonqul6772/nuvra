import type { TextBookmark } from './selection';

/** The document and selection at one point in time. */
export interface Snapshot {
  /** outerHTML of each top-level block; unchanged blocks share the same string with earlier snapshots. */
  blocks: string[];
  /** Selection to restore together with the blocks, or `null` when the editor had no selection. */
  bookmark: TextBookmark | null;
}

/** How a change was made: consecutive typing is grouped into one undo step, commands never are. */
type ChangeKind = 'typing' | 'command';

/** Keystrokes closer together than this become one undo step. */
const TYPING_GROUP_MS = 800;

/** Undo steps kept by default; the oldest ones are dropped beyond this. */
const DEFAULT_LIMIT = 200;

/** Undo/redo stacks of document snapshots with typing grouping and memory sharing between snapshots. */
export class EditorHistory {
  /** States before each change, newest last. */
  private readonly undoStack: Snapshot[] = [];
  /** States replaced by undo, newest last; cleared by any new change. */
  private readonly redoStack: Snapshot[] = [];
  /** Kind of the last recorded change, `null` when the next keystroke must start a new step. */
  private lastKind: ChangeKind | null = null;
  /** Time of the last recorded change, used to group typing. */
  private lastTime = 0;

  /** @param limit Maximum number of steps kept on each stack. */
  constructor(private readonly limit = DEFAULT_LIMIT) {}

  /** Whether there is a step to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether there is an undone step to redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Records the state before a change; `take` runs only when a new undo step actually starts. */
  record(take: () => Snapshot, kind: ChangeKind): void {
    const now = Date.now();
    const grouped = kind === 'typing' && this.lastKind === 'typing' && now - this.lastTime < TYPING_GROUP_MS;
    this.lastKind = kind;
    this.lastTime = now;
    if (grouped) return;
    this.push(this.undoStack, this.share(take()));
    this.redoStack.length = 0;
  }

  /** Starts a new undo step for the next keystroke, e.g. after the caret was moved. */
  breakGroup(): void {
    this.lastKind = null;
  }

  /** Moves one step back: stores `current` for redo and returns the state to restore, or `null` when empty. */
  undo(current: Snapshot): Snapshot | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.push(this.redoStack, this.share(current));
    this.lastKind = null;
    return previous;
  }

  /** Moves one step forward: stores `current` for undo and returns the state to restore, or `null` when empty. */
  redo(current: Snapshot): Snapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.push(this.undoStack, this.share(current));
    this.lastKind = null;
    return next;
  }

  /** Forgets every step, e.g. after the content was replaced from outside. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastKind = null;
  }

  /** Adds a snapshot to a stack and drops the oldest one when the limit is exceeded. */
  private push(stack: Snapshot[], snapshot: Snapshot): void {
    stack.push(snapshot);
    if (stack.length > this.limit) stack.shift();
  }

  /** Reuses identical block strings from the latest snapshot so large documents do not multiply in memory. */
  private share(snapshot: Snapshot): Snapshot {
    const reference = this.undoStack.at(-1) ?? this.redoStack.at(-1);
    if (!reference) return snapshot;
    const pool = new Map(reference.blocks.map(block => [block, block]));
    return { ...snapshot, blocks: snapshot.blocks.map(block => pool.get(block) ?? block) };
  }
}
