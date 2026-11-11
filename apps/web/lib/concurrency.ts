/**
 * Runs `task` over every item with at most `limit` running at once, and returns results in input
 * order. The first failure rejects, like Promise.all, and no new tasks start after it.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/** Splits rows into chunks of at most `size`, for requests with a row limit. */
export function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** Where each page of `total` rows starts. Always at least one page, even for none. */
export function pageStarts(total: number, size: number): number[] {
  return Array.from({ length: Math.max(1, Math.ceil(total / size)) }, (_, i) => i * size);
}
