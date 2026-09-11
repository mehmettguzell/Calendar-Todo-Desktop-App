import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { useViewPrefs } from "@/state/viewPrefsStore";
// Tells React that `act()` is available, which keeps state updates synchronous.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships neither of these, and the app touches both on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

vi.stubGlobal(
  "Notification",
  class {
    static permission = "granted";
    static requestPermission = async () => "granted";
  },
);

/**
 * The tab each page opens on, as a test expects to find it.
 *
 * The app's own defaults are a product decision that moves — Plans now opens on
 * "Başladıklarım" — and a suite whose fixtures are mostly not-started plans
 * would start failing on that change alone. Tests that care about a tab say so
 * themselves; every other test gets the unfiltered view.
 *
 * Set before each test as well as after, because the first test in a run has no
 * `afterEach` in front of it.
 */
const NEUTRAL_VIEW_PREFS = {
  planFilter: "ALL",
  budgetTab: "overview",
  taskFilter: "all",
  taskLayout: "list",
  weekMetric: "tasks",
} as const;

beforeEach(() => {
  useViewPrefs.setState(NEUTRAL_VIEW_PREFS);
});

afterEach(() => {
  // Vitest globals are off, so RTL's auto-cleanup is not registered for us.
  // Without this, a previous test's App stays mounted and subscribed to the
  // same store, and duplicates every element the next test queries for.
  cleanup();
  localStorage.clear();
  // Which tab each page was left on outlives a component on purpose — that is
  // the whole point of the store — so it also outlives a test unless it is put
  // back. A test that starts on somebody else's filter fails somewhere else.
  useViewPrefs.setState(NEUTRAL_VIEW_PREFS);
});
