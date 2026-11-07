import type { AnalysisStats } from "@/lib/analysis/pipeline";
import { formatDate, languageShares, shortSha } from "@/lib/analysis/present";

type Props = {
  stats: AnalysisStats;
  commitSha: string;
  completedAt: string | null;
};

const LANGUAGE_COLORS = ["bg-accent", "bg-accent-2", "bg-muted", "bg-line"];

export function AnalysisResults({ stats, commitSha, completedAt }: Props) {
  const { totals } = stats;
  const languages = languageShares(stats.languages);
  const largestDirectory = stats.directories[0]?.files ?? 0;

  return (
    <>
      <p className="mt-8 text-sm text-muted">
        Analyzed commit <span className="font-mono text-foreground">{shortSha(commitSha)}</span>
        {completedAt && ` on ${formatDate(completedAt)}`}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        <Stat label="Total files" value={totals.allFiles} />
        <Stat label="Directories" value={totals.directories} />
        <Stat label="Source files" value={totals.sourceFiles} />
        <Stat label="Lines of code" value={totals.lines} />
        <Stat label="Internal dependencies" value={totals.internalDependencies} />
        <Stat label="Unresolved imports" value={totals.unresolvedImports} />
      </dl>

      {totals.internalDependencies === 0 && (
        <p className="mt-3 text-sm text-muted">
          No files in this repository import each other, so its dependency graph will be empty.
        </p>
      )}

      <section className="mt-10">
        <h2 className="font-medium">Languages</h2>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-card" aria-hidden>
          {languages.map((language, index) => (
            <span
              key={language.language}
              className={LANGUAGE_COLORS[index % LANGUAGE_COLORS.length]}
              style={{ width: `${language.percent}%` }}
            />
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {languages.map((language) => (
            <li key={language.language} className="flex justify-between gap-4">
              <span>{language.language}</span>
              <span className="text-muted">
                {language.files.toLocaleString("en-US")} files · {language.percent}% of lines
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-medium">Largest directories</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {stats.directories.slice(0, 6).map((directory) => (
            <li key={directory.path}>
              <div className="flex justify-between gap-4">
                <span className="truncate font-mono">{directory.path}</span>
                <span className="shrink-0 text-muted">
                  {directory.files.toLocaleString("en-US")} files
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-card" aria-hidden>
                <div
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${(directory.files / largestDirectory) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-medium">What the analysis found</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>
            {stats.cycleCount === 0
              ? "No runtime import cycles."
              : `${count(stats.cycleCount, "import cycle")} found. A cycle isn't necessarily a bug, but it can make code harder to change.`}
          </li>
          <li>
            {totals.unresolvedImports === 0
              ? "Every local import was matched to a file."
              : `${count(totals.unresolvedImports, "import")} couldn't be matched to a file. They may be generated at build time, or RepoScope may not understand the setup.`}
          </li>
          {stats.unanalyzableCount > 0 && (
            <li>
              {count(stats.unanalyzableCount, "dynamic import")} use a value only known when the code
              runs, so they can&apos;t be followed.
            </li>
          )}
          {totals.skippedFiles > 0 && (
            <li>
              {count(totals.skippedFiles, "file")} skipped, such as lock files, minified bundles and
              generated folders.
            </li>
          )}
          <li>{count(stats.externalPackages.length, "external package")} imported.</li>
        </ul>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}
