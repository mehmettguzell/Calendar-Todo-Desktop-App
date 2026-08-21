import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

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

afterEach(() => {
  // Vitest globals are off, so RTL's auto-cleanup is not registered for us.
  // Without this, a previous test's App stays mounted and subscribed to the
  // same store, and duplicates every element the next test queries for.
  cleanup();
  localStorage.clear();
});
