/**
 * Analyzes a folder and prints a report, for checking accuracy and measuring cost.
 * Usage: node scripts/analyze-folder.ts <folder> [--edges <n>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { analyzeFileSet, buildFileSet, DEFAULT_EXCLUDED_DIRECTORIES } from "../src/index.ts";
import type { InputFile } from "../src/index.ts";

const folder = process.argv[2];
if (!folder) throw new Error("Pass a folder to analyze.");
const sampleSize = Number(process.argv[process.argv.indexOf("--edges") + 1]) || 0;

function readAll(directory: string, files: InputFile[] = []): InputFile[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_EXCLUDED_DIRECTORIES.includes(entry.name)) readAll(path, files);
    } else if (entry.isFile()) {
      files.push({ path: relative(folder!, path).split(sep).join("/"), bytes: readFileSync(path) });
    }
  }
  return files;
}

const inputs = readAll(folder);
const started = performance.now();
const fileSet = buildFileSet(inputs, { maxSourceFiles: Infinity });
const result = analyzeFileSet(fileSet);
const elapsed = performance.now() - started;

const unresolvedBySpecifier = new Map<string, number>();
for (const { specifier } of result.unresolved) {
  unresolvedBySpecifier.set(specifier, (unresolvedBySpecifier.get(specifier) ?? 0) + 1);
}

console.log(JSON.stringify({
  folder,
  milliseconds: Math.round(elapsed),
  peakHeapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
  resultKb: Math.round(JSON.stringify(result).length / 1024),
  totals: result.totals,
  languages: result.languages,
  cycles: result.cycles.length,
  largestCycle: result.cycles[0]?.length ?? 0,
  syntaxErrors: result.files.filter((f) => f.hasSyntaxErrors).map((f) => f.path).slice(0, 10),
  unanalyzable: result.unanalyzable.length,
  skippedByReason: Object.groupBy(fileSet.skipped, (s) => s.reason),
}, (key, value) => (key === "skippedByReason" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (v as unknown[]).length])) : value), 1));

console.log("\nUnresolved (top 40):");
for (const [specifier, count] of [...unresolvedBySpecifier].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const example = result.unresolved.find((u) => u.specifier === specifier)!;
  console.log(`  ${count}x ${specifier}   (${example.source}:${example.line})`);
}

if (sampleSize) {
  console.log(`\nSample of ${sampleSize} edges:`);
  const step = Math.max(1, Math.floor(result.edges.length / sampleSize));
  for (let i = 0; i < result.edges.length && i / step < sampleSize; i += step) {
    const e = result.edges[i]!;
    console.log(`  [${e.type}] ${e.source}:${e.line} "${e.specifier}" -> ${e.target}`);
  }
}
