import { focusElapsedSec } from "../storeTypes";
import {
  appendHistory,
  applyStatus,
  refOf,
} from "../taskMutations";
import {
  pruneTombstones,
  tombstone,
} from "@/data/db";
import {
  nowInstant,
  toInstant,
} from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { createId } from "@/domain/ids";
import { FocusSession } from "@/domain/types";
import type { SliceTools, StoreState } from "../storeState";

// A running timer plus the sessions it leaves behind.
export type FocusSlice = Pick<
  StoreState,
  | "startFocus"
  | "pauseFocus"
  | "resumeFocus"
  | "stopFocus"
  | "cancelFocus"
  | "deleteFocusSession"
  | "clearFocusSessions"
>;

export function createFocusSlice({ set, get, commit }: SliceTools): FocusSlice {
  return {
    startFocus(instance) {
      const state = get();
      if (state.runningFocus) state.stopFocus();

      const session: FocusSession = {
        id: createId("f"),
        taskId: instance.task.id,
        occurrenceDate: instance.isRecurring ? instance.date : null,
        startedAt: nowInstant(),
        endedAt: null,
        durationSec: 0,
      };
      set({
        runningFocus: {
          sessionId: session.id,
          taskId: session.taskId,
          occurrenceDate: session.occurrenceDate,
          startedAt: session.startedAt,
          runStartedAt: session.startedAt,
          bankedSec: 0,
        },
      });
      commit((db) => {
        const withSession = {
          ...db,
          focusSessions: [...db.focusSessions, session],
        };
        // Working on something is the definition of IN_PROGRESS.
        return instance.storedStatus === "TODO"
          ? applyStatus(withSession, refOf(instance), "IN_PROGRESS")
          : withSession;
      });
    },
    /**
     * Stop the clock, keep the session.
     *
     * The seconds are banked onto the row as they are, so a paused timer that
     * never gets resumed — the window closed, the day ended — has still
     * recorded the work that was done. `endedAt` stays null, which is what
     * separates a session that is merely paused from one that is finished.
     */
    pauseFocus() {
      const running = get().runningFocus;
      if (!running?.runStartedAt) return;
      const bankedSec = focusElapsedSec(running);
      set({ runningFocus: { ...running, runStartedAt: null, bankedSec } });
      commit((db) => ({
        ...db,
        focusSessions: db.focusSessions.map((s) =>
          s.id === running.sessionId ? { ...s, durationSec: bankedSec } : s,
        ),
      }));
    },
    resumeFocus() {
      const running = get().runningFocus;
      // Already running: resuming would restart this run and lose its seconds.
      if (!running || running.runStartedAt) return;
      set({ runningFocus: { ...running, runStartedAt: nowInstant() } });
    },
    stopFocus() {
      const running = get().runningFocus;
      if (!running) return;
      const endedAt = new Date();
      const durationSec = focusElapsedSec(running, endedAt.getTime());
      set({ runningFocus: null });
      commit((db) =>
        appendHistory(
          {
            ...db,
            focusSessions: db.focusSessions.map((s) =>
              s.id === running.sessionId
                ? { ...s, endedAt: toInstant(endedAt), durationSec }
                : s,
            ),
          },
          historyEntry({
            taskId: running.taskId,
            kind: "FOCUS_LOGGED",
            occurrenceDate: running.occurrenceDate,
            note: `Focused for ${Math.max(1, Math.round(durationSec / 60))} min`,
          }),
        ),
      );
    },
    /*
     * Every one of these leaves a tombstone behind.
     *
     * A session that is merely absent locally is indistinguishable from one
     * this device has not downloaded yet, so the next sync helpfully hands it
     * back — which is exactly what deleting a session used to look like. The
     * tombstone is what makes the deletion a fact the cloud has to honour.
     */
    cancelFocus() {
      const running = get().runningFocus;
      if (!running) return;
      set({ runningFocus: null });
      const at = nowInstant();
      commit((db) => ({
        ...db,
        focusSessions: db.focusSessions.filter(
          (s) => s.id !== running.sessionId,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("focus", running.sessionId, at),
        ]),
      }));
    },
    deleteFocusSession(sessionId) {
      const at = nowInstant();
      if (get().runningFocus?.sessionId === sessionId) set({ runningFocus: null });
      commit((db) =>
        db.focusSessions.some((s) => s.id === sessionId)
          ? {
              ...db,
              focusSessions: db.focusSessions.filter((s) => s.id !== sessionId),
              tombstones: pruneTombstones([
                ...db.tombstones,
                tombstone("focus", sessionId, at),
              ]),
            }
          : db,
      );
    },
    clearFocusSessions() {
      set({ runningFocus: null });
      const at = nowInstant();
      commit((db) => ({
        ...db,
        focusSessions: [],
        tombstones: pruneTombstones([
          ...db.tombstones,
          ...db.focusSessions.map((s) => tombstone("focus", s.id, at)),
        ]),
      }));
    },
  };
}
