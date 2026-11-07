"use client";

import { ExternalLink, FolderTree, Radar, X } from "lucide-react";
import Link from "next/link";
import { ResizeHandle } from "@/components/resize-handle";
import { githubFileUrl } from "@/lib/graph/details";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";
import { DependencyInspector, SourceView, useFileSource } from "../file-views";
import { LocalAiSection } from "../local-ai";

export const PANEL_LIMITS = { min: 320, max: 760 };

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  repositoryId: string;
  analysisId: string;
  data: GraphPayload;
  file: GraphFile;
  repositoryUrl: string;
  commitSha: string;
  hideUnrelated: boolean;
  onHideUnrelatedChange: (hide: boolean) => void;
  inImpact: boolean;
  onToggleImpact: () => void;
  onOpenFile: (file: GraphFile) => void;
  onClose: () => void;
};

export function FilePanel({
  width,
  onWidthChange,
  repositoryId,
  analysisId,
  data,
  file,
  repositoryUrl,
  commitSha,
  hideUnrelated,
  onHideUnrelatedChange,
  inImpact,
  onToggleImpact,
  onOpenFile,
  onClose,
}: Props) {

  return (
    <aside
      aria-label={`Details for ${file.path}`}
      className="absolute inset-x-0 bottom-0 z-10 flex h-[55%] flex-col border-t border-line bg-sidebar sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:w-[var(--panel-width)] sm:border-t-0 sm:border-l"
    >
      <ResizeHandle
        label="Resize file details"
        side="right"
        width={width}
        onChange={onWidthChange}
        className="hidden sm:block"
        {...PANEL_LIMITS}
      />
      <header className="flex items-start gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-sm font-semibold">{nameOf(file.path)}</h2>
          <p className="truncate font-mono text-xs text-muted" title={file.path}>
            {file.path}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close file details" className="p-1 text-muted hover:text-foreground">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-2 gap-px border-b border-line bg-line text-xs">
          <Fact label="Language" value={file.language} />
          <Fact label="Lines" value={file.lines.toLocaleString("en-US")} />
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hideUnrelated}
              onChange={(event) => onHideUnrelatedChange(event.target.checked)}
            />
            Hide unrelated
          </label>
          <button
            type="button"
            onClick={onToggleImpact}
            aria-pressed={inImpact}
            className="inline-flex items-center gap-1 text-impact hover:underline"
          >
            <Radar size={12} aria-hidden /> {inImpact ? "Remove from impact" : "Show change impact"}
          </button>
          <Link
            href={`/repositories/${repositoryId}/explorer?file=${file.id}`}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <FolderTree size={12} aria-hidden /> Open in Explorer
          </Link>
          <a
            href={githubFileUrl(repositoryUrl, commitSha, file.path)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            View on GitHub <ExternalLink size={12} aria-hidden />
          </a>
        </div>

        <LocalAiSection key={file.id} analysisId={analysisId} data={data} file={file} />
        <DependencyInspector data={data} file={file} onOpenFile={onOpenFile} />

        <section>
          <h3 className="border-b border-line px-3 py-2 text-xs font-medium">Source</h3>
          <Source key={file.id} analysisId={analysisId} fileId={file.id} />
        </section>
      </div>
    </aside>
  );
}

function Source({ analysisId, fileId }: { analysisId: string; fileId: number }) {
  return <SourceView {...useFileSource(analysisId, fileId)} />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-sidebar p-3">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono">{value}</dd>
    </div>
  );
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
