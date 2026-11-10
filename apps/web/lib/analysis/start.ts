import "server-only";
import { after } from "next/server";
import type { RepositoryReader } from "@/lib/github/reader";
import { claimRun } from "./claim";
import { runPipeline } from "./pipeline";
import { runStore, runWriter, snapshotStore } from "./store";

/**
 * Starts one commit's analysis after the response is sent, unless it already ran or is running.
 * The run's unique commit settles repeats, so a webhook delivered twice starts one run. When an
 * earlier analysis left a snapshot, only files that changed since are fetched and parsed.
 */
export async function startAnalysis(
  repositoryId: string,
  commitSha: string,
  reader: RepositoryReader,
) {
  const { run, start } = await claimRun(runStore(repositoryId, commitSha));
  if (start) {
    after(() =>
      runPipeline({
        ...runWriter(run.id),
        download: () => reader.download(commitSha),
        snapshots: {
          ...snapshotStore(repositoryId, run.id),
          commitSha,
          tree: reader.tree,
          blob: reader.blob,
        },
      }),
    );
  }
  return { run, start };
}
