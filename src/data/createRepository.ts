import { isTauri } from "@/lib/env";
import { createFileRepository } from "./fileStore";
import { createLocalStorageRepository } from "./localStore";
import { ANONYMOUS_NAMESPACE } from "./namespace";
import type { Repository } from "./repository";

export function createRepository(
  namespace: string = ANONYMOUS_NAMESPACE,
): Repository {
  return isTauri()
    ? createFileRepository(namespace)
    : createLocalStorageRepository(namespace);
}
