"use client";

import { useState } from "react";
import type { FoundConvention } from "@/lib/conventions/found";

/** Fetched only when asked for. Shown as plain text, as anyone can write these files. */
export function FoundConventions({ repositoryId }: { repositoryId: string }) {
  const [files, setFiles] = useState<FoundConvention[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/repositories/${repositoryId}/found-conventions`).catch(() => null);
    const payload = await response?.json().catch(() => null);

    if (response?.ok) setFiles(payload.data);
    else setError(payload?.error?.message ?? "We couldn't read those files.");
    setBusy(false);
  }

  return (
    <section aria-label="Found in the repository" className="mt-10">
      <h2 className="font-medium">Found in the repository</h2>
      <p className="mt-1 text-sm text-muted">
        Files like AGENTS.md, read-only. The repository wrote these, not you.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {!files && (
        <button type="button" onClick={load} disabled={busy} className="button-secondary mt-3">
          {busy ? "Looking…" : "Look for these files"}
        </button>
      )}

      {files?.length === 0 && (
        <p className="mt-3 text-sm text-muted">This repository has no AGENTS.md, CLAUDE.md or CONTRIBUTING.md.</p>
      )}

      {files && files.length > 0 && (
        <div className="mt-3 space-y-2">
          {files.map((file) => (
            <details key={file.path} className="rounded-md border border-line bg-card">
              <summary className="cursor-pointer p-3 font-mono text-sm">{file.path}</summary>
              {file.content === null ? (
                <p className="border-t border-line p-3 text-sm text-muted">{file.note}</p>
              ) : (
                <pre className="max-h-96 overflow-auto border-t border-line p-3 text-xs whitespace-pre-wrap">
                  {file.content}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
