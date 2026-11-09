import "server-only";
import { after } from "next/server";
import type { RepositoryReader } from "@/lib/github/reader";
import { claimRun } from "./claim";
import { runPipeline } from "./pipeline";
import { runStore, runWriter } from "./store";

/**
 * Starts one commit's analysis after the response is sent, unless it already ran or is running.
 * The run's unique commit settles repeats, so a webhook delivered twice starts one run.
 */
export async function startAnalysis(
  repositoryId: string,
  commitSha: string,
  reader: RepositoryReader,
) {
  const { run, start } = await claimRun(runStore(repositoryId, commitSha));
  if (start) {
    after(() => runPipeline({ ...runWriter(run.id), download: () => reader.download(commitSha) }));
  }
  return { run, start };
}
