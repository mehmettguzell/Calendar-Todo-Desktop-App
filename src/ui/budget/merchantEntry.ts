import { identifyMerchant } from "@/domain/merchant";
import {
  categoryNameFor,
  type BudgetCategory,
  type MoneyFlow,
} from "@/domain/money";
import type { Language } from "@/lib/i18n";

/**
 * What a typed "where" contributes to an entry: the shop, its category, the note.
 *
 * Shared by the tray capture and the evening prompt, which ask the same two
 * questions and must not answer them differently.
 */
export function entryFromText(
  text: string,
  language: Language,
  ensureBudgetCategory: (name: string, flow: MoneyFlow) => BudgetCategory,
) {
  const match = text ? identifyMerchant(text) : null;
  const category = match?.categoryKey
    ? ensureBudgetCategory(categoryNameFor(match.categoryKey, language), "EXPENSE")
    : null;

  return {
    categoryId: category?.id ?? null,
    // "none" means the rules recognised nothing, and a shop name we invented
    // would be worse than leaving it blank.
    merchant: match?.confidence === "none" ? null : (match?.name ?? null),
    note: text,
  };
}
