import { isTauri } from "@/lib/env";
import { createFileRepository } from "./fileStore";
import { createLocalStorageRepository } from "./localStore";
import type { Repository } from "./repository";

export function createRepository(): Repository {
  return isTauri() ? createFileRepository() : createLocalStorageRepository();
}
