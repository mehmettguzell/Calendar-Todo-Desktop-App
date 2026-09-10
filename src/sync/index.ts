/**
 * Cross-device sync.
 *
 * The pure, testable rules live in their own modules here; `syncEngine.ts` (the
 * stateful orchestrator — queue, retry, realtime, lifecycle) is folded in as
 * the split continues.
 */
export * from "./reconcile";
export * from "./writePlan";
export * from "./flushSchedule";
export * from "./watermark";
export * from "./remoteEcho";
