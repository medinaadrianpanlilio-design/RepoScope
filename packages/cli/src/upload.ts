import { summarizeResult } from "../../engine/src/index.ts";
import type { AnalysisResult } from "../../engine/src/index.ts";

const FILES_PER_CHUNK = 500;
const EDGES_PER_CHUNK = 2000;

export type SyncStart = {
  name: string;
  remote: string | null;
  commit: string | null;
  branch: string | null;
  dirty: boolean;
};

type Reply = {
  data?: { upToDate?: boolean; runId?: string };
  error?: { message?: string };
};

type Options = {
  url: string;
  key: string;
  start: SyncStart;
  result: AnalysisResult;
  fetchImpl?: typeof fetch;
};

function chunks<T>(rows: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < rows.length; i += size) groups.push(rows.slice(i, i + size));
  return groups;
}

/** Sends analysis results only. Nothing here has access to a file's contents. */
export async function uploadResult({ url, key, start, result, fetchImpl = fetch }: Options) {
  async function post(path: string, body: unknown) {
    const response = await fetchImpl(`${url}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as Reply | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? `Upload failed (${response.status}).`);
    return payload?.data ?? {};
  }

  const session = await post("/api/sync", start);
  if (session.upToDate) return { uploaded: false };

  const target = `/api/sync/${session.runId}`;

  for (const rows of chunks(result.files, FILES_PER_CHUNK)) {
    await post(target, {
      kind: "files",
      rows: rows.map(({ path, language, size, lines, incoming, outgoing, exports, hasSyntaxErrors }) => ({
        path,
        language,
        size,
        lines,
        incoming,
        outgoing,
        exports,
        hasSyntaxErrors,
      })),
    });
  }
  for (const rows of chunks(result.edges, EDGES_PER_CHUNK)) {
    await post(target, { kind: "edges", rows });
  }
  for (const rows of chunks(result.unresolved, EDGES_PER_CHUNK)) {
    await post(target, { kind: "unresolved", rows });
  }

  await post(target, {
    kind: "complete",
    files: result.files.length,
    edges: result.edges.length,
    unresolved: result.unresolved.length,
    stats: summarizeResult(result),
  });
  return { uploaded: true };
}
