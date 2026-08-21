import { describe, expect, it } from "vitest";
import {
  calculateLevel,
  calculateTotalXp,
  computeActivityMap,
  computeStreaks,
  computeWeeklyStats,
  getMotivationalMessage,
  XP_PER_FOCUS_SESSION,
  XP_PER_TASK,
} from "../gamification";
import type { FocusSession, HistoryEntry, Occurrence, Task } from "../types";

describe("Gamification Domain", () => {
  describe("Level and XP calculation", () => {
    it("starts at Level 1 with 0 XP", () => {
      const level = calculateLevel(0);
      expect(level.level).toBe(1);
      expect(level.title).toBe("Acemi Planlayıcı");
      expect(level.progressPercent).toBe(0);
    });

    it("calculates level progression and percentage correctly", () => {
      const level = calculateLevel(150);
      expect(level.level).toBe(2);
      expect(level.title).toBe("Görev Avcısı");
      // Level 2 is 100 - 250 (range 150), so 150 XP is 50 in current level = 33%
      expect(level.progressPercent).toBe(33);
    });

    it("handles max level correctly", () => {
      const level = calculateLevel(15000);
      expect(level.level).toBe(10);
      expect(level.title).toBe("Zamanın Efendisi");
      expect(level.progressPercent).toBe(100);
    });
  });

  describe("computeActivityMap and XP", () => {
    it("aggregates completed tasks from history and focus sessions", () => {
      const tasks: Task[] = [];
      const occurrences: Occurrence[] = [];
      const focusSessions: FocusSession[] = [
        {
          id: "f1",
          taskId: "t1",
          occurrenceDate: null,
          startedAt: "2026-08-22T10:00:00.000Z",
          endedAt: "2026-08-22T10:30:00.000Z",
          durationSec: 1800,
        },
      ];
      const history: HistoryEntry[] = [
        {
          id: "h1",
          taskId: "t1",
          at: "2026-08-22T11:00:00.000Z",
          kind: "STATUS_CHANGED",
          occurrenceDate: null,
          field: "status",
          from: "TODO",
          to: "COMPLETED",
          note: null,
        },
        {
          id: "h2",
          taskId: "t2",
          at: "2026-08-22T14:00:00.000Z",
          kind: "STATUS_CHANGED",
          occurrenceDate: null,
          field: "status",
          from: "TODO",
          to: "COMPLETED",
          note: null,
        },
      ];

      const map = computeActivityMap(
        tasks,
        occurrences,
        focusSessions,
        history,
      );
      const todayActivity = map.get("2026-08-22");

      expect(todayActivity).toBeDefined();
      expect(todayActivity?.tasksDone).toBe(2);
      expect(todayActivity?.focusMinutes).toBe(30);
      expect(todayActivity?.xp).toBe(
        2 * XP_PER_TASK + 1 * XP_PER_FOCUS_SESSION,
      );
      expect(todayActivity?.intensity).toBeGreaterThan(0);

      const totalXp = calculateTotalXp(map);
      expect(totalXp).toBe(40);
    });
  });

  describe("computeStreaks", () => {
    it("calculates active streak when today is active", () => {
      const map = computeActivityMap(
        [],
        [],
        [],
        [
          {
            id: "h1",
            taskId: "t1",
            at: "2026-08-20T10:00:00.000Z",
            kind: "STATUS_CHANGED",
            occurrenceDate: null,
            field: "status",
            from: "TODO",
            to: "COMPLETED",
            note: null,
          },
          {
            id: "h2",
            taskId: "t2",
            at: "2026-08-21T10:00:00.000Z",
            kind: "STATUS_CHANGED",
            occurrenceDate: null,
            field: "status",
            from: "TODO",
            to: "COMPLETED",
            note: null,
          },
          {
            id: "h3",
            taskId: "t3",
            at: "2026-08-22T10:00:00.000Z",
            kind: "STATUS_CHANGED",
            occurrenceDate: null,
            field: "status",
            from: "TODO",
            to: "COMPLETED",
            note: null,
          },
        ],
      );

      const streaks = computeStreaks(map, "2026-08-22");
      expect(streaks.isActiveToday).toBe(true);
      expect(streaks.currentStreak).toBe(3);
      expect(streaks.longestStreak).toBe(3);
      expect(streaks.totalActiveDays).toBe(3);
    });

    it("preserves yesterday's streak if today has no activity yet", () => {
      const map = computeActivityMap(
        [],
        [],
        [],
        [
          {
            id: "h1",
            taskId: "t1",
            at: "2026-08-21T10:00:00.000Z",
            kind: "STATUS_CHANGED",
            occurrenceDate: null,
            field: "status",
            from: "TODO",
            to: "COMPLETED",
            note: null,
          },
        ],
      );

      const streaks = computeStreaks(map, "2026-08-22");
      expect(streaks.isActiveToday).toBe(false);
      expect(streaks.currentStreak).toBe(1);
    });
  });

  describe("computeWeeklyStats", () => {
    it("returns stats for 7 days ending today", () => {
      const map = computeActivityMap([], [], [], []);
      const weekly = computeWeeklyStats(map, "2026-08-22", 7);
      expect(weekly).toHaveLength(7);
      const last = weekly[6];
      expect(last?.date).toBe("2026-08-22");
      expect(last?.isToday).toBe(true);
    });
  });

  describe("getMotivationalMessage", () => {
    it("returns celebration message when 100% complete", () => {
      const msg = getMotivationalMessage({
        openCount: 0,
        doneCount: 5,
        overdueCount: 0,
        streak: 3,
      });
      expect(msg.badgeType).toBe("celebrate");
      expect(msg.title).toContain("Günün Kahramanı");
    });

    it("returns warning when overdue tasks exist", () => {
      const msg = getMotivationalMessage({
        openCount: 2,
        doneCount: 1,
        overdueCount: 2,
        streak: 1,
      });
      expect(msg.badgeType).toBe("warning");
      expect(msg.title).toContain("gecikmiş");
    });
  });
});
