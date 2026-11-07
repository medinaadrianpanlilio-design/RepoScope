"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { RiskReport } from "@/lib/graph/risk-input";

export function RiskPanel({ repositoryId }: { repositoryId: string }) {
  const [report, setReport] = useState<RiskReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/repositories/${repositoryId}/risks`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => setReport(payload.data))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [repositoryId]);

  return (
    <section aria-label="Risk warnings" className="mt-10">
      <h2 className="font-medium">Since the last analysis</h2>

      {failed && (
        <p role="alert" className="mt-2 text-sm text-danger">
          We couldn&apos;t work out the warnings.
        </p>
      )}
      {!failed && !report && (
        <p role="status" className="mt-2 text-sm text-muted">
          Comparing analyses…
        </p>
      )}
      {report && report.warnings.length === 0 && (
        <p className="mt-2 text-sm text-muted">
          {report.compared
            ? "Nothing new stood out. That doesn't prove nothing is wrong."
            : "This is the first analysis, so there's nothing to compare it with yet."}
        </p>
      )}

      {report && report.warnings.length > 0 && (
        <ul className="mt-3 space-y-2">
          {report.warnings.map((warning) => (
            <li key={warning.id} className="rounded-md border border-line bg-card p-3 text-sm">
              <p className="flex items-start gap-2 font-medium break-words">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-accent-2" aria-hidden />
                <span className="min-w-0">{warning.title}</span>
              </p>
              <p className="mt-1 text-muted break-words">{warning.evidence}</p>
              {warning.totalFiles > 1 && (
                <ul className="mt-2 space-y-0.5 font-mono text-xs">
                  {warning.files.map((file) => (
                    <li key={file} className="truncate">
                      {file}
                    </li>
                  ))}
                  {warning.totalFiles > warning.files.length && (
                    <li className="text-muted">and {warning.totalFiles - warning.files.length} more</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
