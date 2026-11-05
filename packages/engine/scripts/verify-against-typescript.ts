/**
 * Compares the engine's import resolution with TypeScript's own resolver, as an
 * independent check. Reads files only; nothing in the target folder is executed.
 * Usage: node scripts/verify-against-typescript.ts <folder>
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import ts from "typescript";
import { buildFileSet, DEFAULT_EXCLUDED_DIRECTORIES } from "../src/index.ts";
import type { InputFile } from "../src/index.ts";
import { parseFile } from "../src/parse.ts";
import { createResolver } from "../src/resolve.ts";

const folder = resolvePath(process.argv[2] ?? "");

function readAll(directory: string, files: InputFile[] = []): InputFile[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_EXCLUDED_DIRECTORIES.includes(entry.name)) readAll(path, files);
    } else if (entry.isFile()) {
      files.push({ path: relative(folder, path).split(sep).join("/"), bytes: readFileSync(path) });
    }
  }
  return files;
}

const fileSet = buildFileSet(readAll(folder), { maxSourceFiles: Infinity });
const ours = createResolver({
  sourcePaths: new Set(fileSet.sources.map((f) => f.path)),
  allPaths: fileSet.allPaths,
  configs: fileSet.configs,
});

const optionsCache = new Map<string, ts.CompilerOptions>();
function optionsFor(file: string): ts.CompilerOptions {
  let directory = dirname(file);
  while (true) {
    const cached = optionsCache.get(directory);
    if (cached) return cached;
    const config = ["tsconfig.json", "jsconfig.json"].map((n) => join(directory, n)).find(existsSync);
    if (config || directory === folder || dirname(directory) === directory) {
      const parsed = config
        ? ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config, ts.sys, directory, undefined, config)
        : { options: {} };
      const options = {
        ...parsed.options,
        allowJs: true,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      };
      optionsCache.set(directory, options);
      return options;
    }
    directory = dirname(directory);
  }
}

const counts = { compared: 0, agree: 0, prefersImplementation: 0, disagree: 0, tsOnly: 0, oursOnly: 0, bothNotFound: 0 };
const disagreements: string[] = [];
const tsOnly: string[] = [];
const oursOnly = new Map<string, number>();

for (const { path, content } of fileSet.sources) {
  const absolute = join(folder, path);
  for (const { specifier, line } of parseFile(path, content).imports) {
    const mine = ours.resolve(path, specifier);
    if (mine.kind === "external" || mine.kind === "non_source") {
      if (!specifier.startsWith(".")) continue;
    }

    const found = ts.resolveModuleName(specifier.split("?")[0]!, absolute, optionsFor(absolute), ts.sys).resolvedModule;
    const theirs = found ? relative(folder, found.resolvedFileName).split(sep).join("/") : null;
    const theirsInRepo = theirs !== null && !theirs.startsWith("..") && !theirs.includes("node_modules/") && fileSet.allPaths.has(theirs);
    const myTarget = mine.kind === "internal" || mine.kind === "non_source" ? mine.target : null;

    counts.compared++;
    if (theirsInRepo && myTarget === theirs) counts.agree++;
    else if (theirsInRepo && myTarget && /\.d\.[cm]?ts$/.test(theirs!)) counts.prefersImplementation++;
    else if (theirsInRepo && myTarget) { counts.disagree++; disagreements.push(`${path}:${line} "${specifier}" ours=${myTarget} ts=${theirs}`); }
    else if (theirsInRepo) { counts.tsOnly++; tsOnly.push(`${path}:${line} "${specifier}" ts=${theirs}`); }
    else if (myTarget) { counts.oursOnly++; const key = myTarget.endsWith(".ts") || myTarget.endsWith(".tsx") || myTarget.endsWith(".js") ? "source" : "asset"; oursOnly.set(key, (oursOnly.get(key) ?? 0) + 1); if (key === "source" && (oursOnly.get("shown") ?? 0) < 12) { oursOnly.set("shown", (oursOnly.get("shown") ?? 0) + 1); disagreements.push(`OURS-ONLY ${path}:${line} "${specifier}" ours=${myTarget}`); } }
    else counts.bothNotFound++;
  }
}

console.log(JSON.stringify({ folder, sources: fileSet.sources.length, ...counts, oursOnly: Object.fromEntries(oursOnly) }));
for (const line of disagreements.slice(0, 20)) console.log("  " + line);
for (const line of tsOnly.slice(0, 20)) console.log("  TS-ONLY " + line);
