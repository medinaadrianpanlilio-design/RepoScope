"use client";

import { Check, Circle, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { isActive, progressSteps } from "@/lib/analysis/present";

type Run = { id: string; status: string; errorMessage: string | null };

type Props = {
  repositoryId: string;
  run: Run | null;
  hasResults: boolean;
  autoStart: boolean;
};

const POLL_MS = 1000;
const MAX_POLL_FAILURES = 5;

export function AnalysisPanel({ repositoryId, run: initialRun, hasResults, autoStart }: Props) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/repositories/${repositoryId}/analyze`, { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error?.message ?? "We couldn't start the analysis.");
      } else if (payload.data.started) {
        setRun({ id: payload.data.analysisId, status: "queued", errorMessage: null });
      } else if (payload.data.analysisId === initialRun?.id && initialRun?.status === "completed") {
        setNotice("Already up to date with the latest commit.");
      } else {
        setRun({ id: payload.data.analysisId, status: "fetching", errorMessage: null });
      }
    } catch {
      setError("We couldn't reach RepoScope. Check your connection and try again.");
    }
    setStarting(false);
  }, [repositoryId, initialRun]);

  useEffect(() => {
    if (!autoStart || initialRun || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [autoStart, initialRun, start]);

  const activeId = run && isActive(run.status) ? run.id : null;

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch(`/api/analysis/${activeId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("status request failed");
        const { data } = await response.json();
        if (stopped) return;

        failures = 0;
        setRun({ id: data.id, status: data.status, errorMessage: data.errorMessage });
        if (data.status === "completed") {
          router.refresh();
          return;
        }
        if (!isActive(data.status)) return;
      } catch {
        if (stopped) return;
        if (++failures >= MAX_POLL_FAILURES) {
          setError("We lost contact with the analysis. Reload the page to check on it.");
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeId, router]);

  if (activeId && run) {
    return (
      <section aria-label="Analysis progress" className="mt-8 rounded-md border border-line bg-card p-6">
        <h2 className="font-medium">Analyzing this repository</h2>
        <ol className="mt-4 space-y-2 text-sm" aria-live="polite">
          {progressSteps(run.status).map((step) => (
            <li
              key={step.label}
              className={`flex items-center gap-2 ${step.state === "waiting" ? "text-muted" : ""}`}
            >
              {step.state === "done" && <Check size={16} className="text-accent" aria-hidden />}
              {step.state === "active" && (
                <LoaderCircle size={16} className="animate-spin text-accent" aria-hidden />
              )}
              {step.state === "waiting" && <Circle size={16} aria-hidden />}
              <span>{step.label}</span>
              {step.state === "active" && <span className="sr-only">(in progress)</span>}
            </li>
          ))}
        </ol>
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (run?.status === "completed" || (hasResults && run?.status !== "failed")) {
    return (
      <SyncBar repositoryId={repositoryId} onSync={start} syncing={starting} notice={notice} error={error} />
    );
  }

  const failed = run?.status === "failed";

  return (
    <section className="mt-8 rounded-md border border-dashed border-line p-8">
      <h2 className="font-medium">{failed ? "The analysis didn't finish" : "Not analyzed yet"}</h2>
      <p className="mt-1 text-sm text-muted">
        {failed
          ? run.errorMessage
          : "Analyze this repository to map its files and dependencies. Its code is read, never run."}
      </p>
      {failed && hasResults && (
        <p className="mt-1 text-sm text-muted">The results below are from an earlier analysis.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" onClick={start} disabled={starting} className="button-primary mt-4">
        {starting ? "Starting…" : failed ? "Try again" : "Analyze repository"}
      </button>
    </section>
  );
}

type Freshness =
  | { state: "checking" }
  | { state: "behind" | "current"; branch: string }
  | { state: "unreadable" | "unchecked"; message: string };

/** Answers that mean RepoScope can't read the repository at all, not that GitHub was busy. */
const UNREADABLE = new Set([
  "not_found",
  "github_unverified",
  "github_revoked",
  "github_suspended",
  "github_no_access",
  "github_permissions",
]);

type SyncBarProps = {
  repositoryId: string;
  onSync: () => void;
  syncing: boolean;
  notice: string | null;
  error: string | null;
};

/** GitHub doesn't retry failed webhooks, so opening a repository asks whether it's behind. */
function SyncBar({ repositoryId, onSync, syncing, notice, error }: SyncBarProps) {
  const [freshness, setFreshness] = useState<Freshness>({ state: "checking" });

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const response = await fetch(`/api/repositories/${repositoryId}/freshness`, { cache: "no-store" });
        const payload = await response.json();
        if (stopped) return;
        if (response.ok) {
          const { behind, branch } = payload.data;
          setFreshness({ state: behind ? "behind" : "current", branch });
        } else {
          const message = payload.error?.message ?? "We couldn't check GitHub for new commits.";
          setFreshness({
            state: UNREADABLE.has(payload.error?.code) ? "unreadable" : "unchecked",
            message,
          });
        }
      } catch {
        if (!stopped) setFreshness({ state: "unchecked", message: "We couldn't check GitHub for new commits." });
      }
    }
    void check();
    return () => {
      stopped = true;
    };
  }, [repositoryId]);

  if (freshness.state === "unreadable") {
    return (
      <section role="status" className="mt-8 rounded-md border border-danger/60 bg-card p-4 text-sm">
        <h2 className="font-medium text-danger">RepoScope can&apos;t read this repository right now</h2>
        <p className="mt-1">{freshness.message}</p>
        <p className="mt-1 text-muted">The results below are from the last analysis RepoScope could make.</p>
      </section>
    );
  }

  const behind = freshness.state === "behind";

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        className={`${behind ? "button-primary" : "button-secondary"} gap-2`}
      >
        <RefreshCw size={14} aria-hidden />
        {syncing ? "Checking GitHub…" : "Sync"}
      </button>
      {!notice && !error && (
        <p role="status" className={`text-sm ${behind ? "" : "text-muted"}`}>
          {freshness.state === "checking" && "Checking GitHub for new commits…"}
          {freshness.state === "behind" && `GitHub has newer commits on ${freshness.branch}. Sync to analyze them.`}
          {freshness.state === "current" && `Up to date with ${freshness.branch} on GitHub.`}
          {freshness.state === "unchecked" && freshness.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
