import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "@/domain/types";
import {
  cloudTaskFingerprint,
  localTaskFingerprint,
  taskFromRow,
} from "@/data/dto";
import { withTimeout } from "./cloudRequest";
import { upsertTasksToCloud } from "./cloudWrites";

export interface TaskMerge {
  merged: Task[];
  uploaded: number;
  downloaded: number;
}

export interface TaskMergeInput {
  client: SupabaseClient;
  userId: string;
  local: Task[];
  cloud: Record<string, unknown>[];
  tombstoned: Set<string>;
  /** A partial read cannot tell "the cloud never got this" from "unchanged". */
  incremental: boolean;
}

interface Decision {
  merged: Map<string, Task>;
  toUpload: Task[];
  resurrected: string[];
  downloaded: number;
}

/** Row-level last-write-wins; ties go to the cloud so both devices agree. */
function decideRows(input: TaskMergeInput): Decision {
  const cloudById = new Map(input.cloud.map((t) => [t.id, t]));
  const merged = new Map(input.local.map((t) => [t.id, t]));
  const toUpload: Task[] = [];
  const resurrected: string[] = [];
  let downloaded = 0;

  for (const localTask of input.local) {
    const cloudTask = cloudById.get(localTask.id);
    if (!cloudTask) {
      if (!input.incremental) toUpload.push(localTask);
      continue;
    }
    if (cloudTaskFingerprint(cloudTask) === localTaskFingerprint(localTask)) {
      continue;
    }
    const cloudWins =
      new Date(cloudTask.updated_at as string).getTime() >=
      new Date(localTask.updatedAt).getTime();
    if (!cloudWins) {
      toUpload.push(localTask);
      continue;
    }
    merged.set(
      localTask.id,
      taskFromRow(cloudTask, localTask.order, localTask.manualOrder ?? null),
    );
    downloaded++;
  }

  const localIds = new Set(input.local.map((t) => t.id));
  for (const cloudTask of input.cloud) {
    const id = cloudTask.id as string;
    if (localIds.has(id) || cloudTask.is_deleted) continue;
    // Purged on this device: the absence is a decision, not a gap.
    if (input.tombstoned.has(id)) {
      resurrected.push(id);
      continue;
    }
    merged.set(id, taskFromRow(cloudTask, merged.size, null));
    downloaded++;
  }

  return { merged, toUpload, resurrected, downloaded };
}

export async function mergeTasks(input: TaskMergeInput): Promise<TaskMerge> {
  const decision = decideRows(input);

  if (decision.toUpload.length > 0) {
    const { error } = await upsertTasksToCloud(decision.toUpload, input.userId);
    if (error) {
      console.error("[tempo sync] tasks upsert error:", error);
      throw error;
    }
  }

  if (decision.resurrected.length > 0) {
    await withTimeout(
      input.client
        .from("tasks")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .in("id", decision.resurrected)
        .eq("user_id", input.userId),
      "task tombstone push",
    );
  }

  return {
    merged: Array.from(decision.merged.values()),
    uploaded: decision.toUpload.length,
    downloaded: decision.downloaded,
  };
}
