import { create } from "zustand";
import type { LocalDate } from "@/domain/types";

/**
 * The calendar clipboard.
 *
 * Deliberately *not* the system clipboard. What is being carried is a task —
 * with its subtasks, category, estimate and repeat rule — and the moment that
 * goes through `text/plain` it becomes a string that has to be parsed back into
 * something guessed. Holding the id instead means paste reads the live task, so
 * a copy made ten minutes ago pastes what the task says now rather than what it
 * said then.
 *
 * It is also why the clipboard does not survive a restart: an id whose task has
 * since been deleted is a paste that fails for no visible reason.
 */
export type ClipboardMode = "copy" | "cut";

export interface Clip {
  taskId: string;
  /** Shown in the paste menu item, so the user can see what they are pasting. */
  title: string;
  mode: ClipboardMode;
  /** Where it was taken from — a cut needs to know what it is moving away. */
  from: LocalDate | null;
}

interface ClipboardState {
  clip: Clip | null;
  copy(taskId: string, title: string, from: LocalDate | null): void;
  cut(taskId: string, title: string, from: LocalDate | null): void;
  /** Clear the clip. Called after a cut lands: a move happens exactly once. */
  clear(): void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  clip: null,
  copy: (taskId, title, from) => set({ clip: { taskId, title, mode: "copy", from } }),
  cut: (taskId, title, from) => set({ clip: { taskId, title, mode: "cut", from } }),
  clear: () => set({ clip: null }),
}));
