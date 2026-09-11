// Supabase requests have no client-side deadline of their own; on a captive
// portal or a sleeping project they can hang for minutes. "Sync" must always
// come back with an answer, even when the answer is that it could not be done.

const REQUEST_TIMEOUT_MS = 15_000;

export async function withTimeout<T>(
  work: PromiseLike<T>,
  label: string,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${label} timed out after ${Math.round(ms / 1000)}s`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
