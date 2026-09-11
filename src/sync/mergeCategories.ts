import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/domain/types";
import {
  cloudCategoryFingerprint,
  localCategoryFingerprint,
  toCategoryRow,
} from "@/data/dto";
import { withTimeout } from "./cloudRequest";
import { chunked, UPSERT_CHUNK_SIZE } from "./cloudWrites";

export interface CategoryMerge {
  merged: Category[];
  uploaded: number;
  downloaded: number;
}

export interface CategoryMergeInput {
  client: SupabaseClient;
  userId: string;
  local: Category[];
  cloud: Record<string, unknown>[];
  tombstoned: Set<string>;
  /** A partial read cannot tell "the cloud never got this" from "unchanged". */
  incremental: boolean;
}

function categoriesToUpload(input: CategoryMergeInput): Category[] {
  const cloudById = new Map(input.cloud.map((c) => [c.id, c]));
  return input.local.filter((localCat) => {
    const cloudCat = cloudById.get(localCat.id);
    const missing = !cloudCat && !input.incremental;
    const differs =
      cloudCat !== undefined &&
      cloudCategoryFingerprint(cloudCat) !== localCategoryFingerprint(localCat);
    return missing || differs;
  });
}

async function pushCategories(
  input: CategoryMergeInput,
  rows: Category[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const batch of chunked(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await withTimeout(
      input.client.from("categories").upsert(
        batch.map((c) => toCategoryRow(c, input.userId, now)),
        { onConflict: "id,user_id" },
      ),
      "category upsert",
    );
    if (error) throw error;
  }
}

/** Cloud rows this device already has under another id, or deleted for good. */
function retireInCloud(input: CategoryMergeInput, ids: string[]): void {
  if (ids.length === 0) return;
  void input.client
    .from("categories")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("user_id", input.userId);
}

export async function mergeCategories(
  input: CategoryMergeInput,
): Promise<CategoryMerge> {
  const toUpload = categoriesToUpload(input);
  if (toUpload.length > 0) await pushCategories(input, toUpload);

  const localById = new Map(input.local.map((c) => [c.id, c]));
  const localByName = new Map(
    input.local.map((c) => [c.name.trim().toLowerCase(), c]),
  );
  const merged = [...input.local];
  const retire: string[] = [];
  let downloaded = 0;

  for (const cloudCat of input.cloud) {
    if (cloudCat.is_deleted) continue;
    const id = cloudCat.id as string;
    // Deleted here for good, or held under another id: teach the cloud rather
    // than take the row back.
    const name = String(cloudCat.name ?? "").trim().toLowerCase();
    if (input.tombstoned.has(id)) {
      retire.push(id);
      continue;
    }
    if (!name) continue;
    if (localById.has(id)) continue;
    if (localByName.has(name)) {
      retire.push(id);
      continue;
    }

    const newCat: Category = {
      id,
      name: String(cloudCat.name).trim(),
      color: cloudCat.color as string,
      order: merged.length,
    };
    merged.push(newCat);
    localByName.set(name, newCat);
    downloaded++;
  }

  retireInCloud(input, retire);
  return { merged, uploaded: toUpload.length, downloaded };
}
