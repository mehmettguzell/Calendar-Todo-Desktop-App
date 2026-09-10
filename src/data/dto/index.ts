/**
 * DTO layer: the Supabase row shapes and the mappers between them and the
 * domain entities. Nothing here does I/O; it is the translation the gateways
 * and the sync services share.
 */
export * from "./rowValues";
export * from "./optionalColumns";
export * from "./taskRow";
export * from "./categoryRow";
export * from "./occurrenceRow";
export * from "./reminderRow";
export * from "./transactionRow";
export * from "./budgetCategoryRow";
export * from "./wishlistRow";
export * from "./deadlineRow";
export * from "./statementBatchRow";
export * from "./focusSessionRow";
export * from "./historyRow";
