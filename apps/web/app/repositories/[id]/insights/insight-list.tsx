"use client";

import { CircleAlert, Info, Share2, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocalAi } from "@/lib/ai/connection";
import { streamChat } from "@/lib/ai/local";
import { insightMessages } from "@/lib/ai/prompts";
import type { Insight, InsightCategory, InsightSeverity } from "@/lib/graph/insights";
import { LocalAiConnect } from "../local-ai";

const CATEGORY_LABELS: Record<InsightCategory, string> = {
  dependencies: "Dependencies",
  cycles: "Import cycles",
  imports: "Imports",
  structure: "Structure",
};

const SEVERITIES: Record<InsightSeverity, { label: string; icon: ReactNode }> = {
  warning: { label: "Worth a look", icon: <TriangleAlert size={14} className="text-accent-2" aria-hidden /> },
  notice: { label: "Notice", icon: <CircleAlert size={14} className="text-accent" aria-hidden /> },
  info: { label: "For information", icon: <Info size={14} className="text-muted" aria-hidden /> },
};

const EXPLANATION_TOKENS = 220;

type Props = { repositoryId: string; insights: Insight[] };

export function InsightList({ repositoryId, insights }: Props) {
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const ai = useLocalAi();

  const categories = useMemo(
    () => [...new Set(insights.map((insight) => insight.category))],
    [insights],
  );
  const severities = useMemo(
    () => [...new Set(insights.map((insight) => insight.severity))],
    [insights],
  );
  const visible = insights.filter(
    (insight) =>
      (!category || insight.category === category) && (!severity || insight.severity === severity),
  );

  if (insights.length === 0) {
    return (
      <div className="mt-6 rounded-md border border-dashed border-line p-8">
        <h2 className="font-medium">Nothing stood out</h2>
        <p className="mt-1 text-sm text-muted">
          No file, folder or cycle looked unusual for this repository. That doesn&apos;t mean there&apos;s
          nothing to improve, only that these checks found nothing.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mt-4 text-sm text-muted">
        Observations from the analysis. They&apos;re starting points for a closer look, not proof that
        anything is wrong.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <label>
          <span className="sr-only">Filter by category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="field w-auto"
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by severity</span>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className="field w-auto"
          >
            <option value="">All levels</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {SEVERITIES[value].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {ai.phase !== "connected" && (
        <div className="mt-4 rounded-md border border-line bg-card p-3 text-xs">
          <h2 className="flex items-center gap-1.5 font-medium">
            <Sparkles size={14} className="text-accent-2" aria-hidden />
            Explain insights with local AI
          </h2>
          <LocalAiConnect />
        </div>
      )}

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No insights match these filters.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((insight) => (
            <li key={insight.id}>
              <InsightCard repositoryId={repositoryId} insight={insight} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InsightCard({ repositoryId, insight }: { repositoryId: string; insight: Insight }) {
  const { label, icon } = SEVERITIES[insight.severity];
  const more = insight.totalFiles - insight.files.length;

  return (
    <article className="rounded-md border border-line bg-card p-4 text-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1.5 font-medium">
          {icon}
          {insight.title}
        </h2>
        <span className="text-xs text-muted">
          {label} · {CATEGORY_LABELS[insight.category]}
        </span>
      </header>

      <p className="mt-2">{insight.description}</p>
      <p className="mt-1 text-muted">{insight.explanation}</p>
      <p className="mt-2">
        <span className="font-medium">Next: </span>
        {insight.nextAction}
      </p>

      {insight.files.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-t border-line pt-2 text-xs">
          {insight.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2">
              {file.id === null ? (
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              ) : (
                <>
                  <Link
                    href={`/repositories/${repositoryId}/explorer?file=${file.id}`}
                    title={file.path}
                    className="min-w-0 flex-1 truncate font-mono hover:text-accent"
                  >
                    {file.path}
                  </Link>
                  <Link
                    href={`/repositories/${repositoryId}/architecture?file=${file.id}`}
                    aria-label={`View ${file.path} in the graph`}
                    title="View in graph"
                    className="shrink-0 text-muted hover:text-accent"
                  >
                    <Share2 size={12} aria-hidden />
                  </Link>
                </>
              )}
              {file.detail && <span className="shrink-0 text-muted">{file.detail}</span>}
            </li>
          ))}
          {more > 0 && <li className="text-muted">and {more.toLocaleString("en-US")} more</li>}
        </ul>
      )}

      <Explanation insight={insight} />
    </article>
  );
}

function Explanation({ insight }: { insight: Insight }) {
  const ai = useLocalAi();
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  if (ai.phase !== "connected") return null;
  const { endpoint, model } = ai;

  async function explain() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError(null);
    setText("");

    try {
      const answer = await streamChat({
        endpoint,
        model,
        messages: insightMessages(insight),
        maxTokens: EXPLANATION_TOKENS,
        onText: setText,
        signal: controller.signal,
      });
      if (!answer.trim()) setError("Your local AI returned an empty answer.");
    } catch (failure) {
      if ((failure as Error).name !== "AbortError") {
        setError("Your local AI stopped responding. Check that it's still running.");
      }
    }
    setRunning(false);
  }

  return (
    <div className="mt-3 text-xs">
      {text && (
        <figure className="mb-2 rounded border border-accent-2/40 bg-background p-2">
          <figcaption className="mb-1 text-[10px] font-medium tracking-wide text-accent-2 uppercase">
            AI explanation
          </figcaption>
          <p className="whitespace-pre-wrap">{text}</p>
        </figure>
      )}
      {error && (
        <p role="alert" className="mb-2 text-danger">
          {error}
        </p>
      )}
      <button type="button" onClick={explain} disabled={running} className="button-secondary gap-1.5">
        <Sparkles size={12} aria-hidden />
        {running ? "Writing…" : text ? "Explain again" : "Explain in plain words"}
      </button>
    </div>
  );
}
