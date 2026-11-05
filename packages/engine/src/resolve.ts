import ts from "typescript";
import type { Resolution } from "./types.ts";

type ResolverInput = {
  sourcePaths: Set<string>;
  allPaths: Set<string>;
  configs: Map<string, string>;
};

type PathAlias = { pattern: string; targets: string[] };

type CompilerPaths = {
  aliases: PathAlias[];
  /** Repository-relative directory, or null when no baseUrl is set. */
  baseDirectory: string | null;
};

type PackageInfo = {
  directory: string;
  name: string | undefined;
  main: string | undefined;
  exports: unknown;
  imports: Record<string, unknown>;
  dependencies: Record<string, unknown>;
};

const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

const COMPILED_EXTENSIONS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts"],
};

const CONDITIONS = ["source", "import", "module", "node", "require", "browser", "default"];

export function createResolver({ sourcePaths, allPaths, configs }: ResolverInput) {
  const packages = readPackages(configs);
  const packagesByName = groupByName(packages);
  const workspacePatterns = readWorkspacePatterns(configs);
  const compilerPaths = new Map<string, CompilerPaths>();

  for (const path of configs.keys()) {
    if (/(?:^|\/)[tj]sconfig\.json$/.test(path)) {
      compilerPaths.set(dirname(path), readCompilerPaths(path, configs));
    }
  }

  /** Finds the file an import path points to, trying what bundlers and TypeScript try. */
  function locate(path: string | null): Resolution | null {
    if (path === null) return null;

    if (sourcePaths.has(path)) return { kind: "internal", target: path };

    const candidates = [
      ...compiledCandidates(path),
      ...EXTENSIONS.map((extension) => path + extension),
      ...EXTENSIONS.map((extension) => join(path, `index${extension}`)),
    ];
    for (const candidate of candidates) {
      if (sourcePaths.has(candidate)) return { kind: "internal", target: candidate };
    }

    // The file exists but wasn't parsed, such as a CSS file or an oversized module.
    for (const candidate of [path, ...candidates]) {
      if (allPaths.has(candidate)) return { kind: "non_source", target: candidate };
    }
    return null;
  }

  function nearest<T>(from: string, lookup: (directory: string) => T | undefined): T | undefined {
    let directory = dirname(from);
    while (true) {
      const found = lookup(directory);
      if (found !== undefined) return found;
      if (directory === "") return undefined;
      directory = dirname(directory);
    }
  }

  function resolveAlias(from: string, specifier: string): Resolution | null {
    const config = nearest(from, (directory) => compilerPaths.get(directory));
    if (!config) return null;

    const matches = config.aliases
      .map((alias) => ({ alias, capture: matchPattern(alias.pattern, specifier) }))
      .filter((match) => match.capture !== null)
      .sort((a, b) => b.alias.pattern.length - a.alias.pattern.length);

    for (const { alias, capture } of matches) {
      for (const target of alias.targets) {
        const found = locate(normalize(target.replace("*", capture ?? "")));
        if (found) return found;
      }
    }

    if (config.baseDirectory !== null) {
      return locate(normalize(join(config.baseDirectory, specifier)));
    }
    return null;
  }

  function resolveSubpathImport(from: string, specifier: string): Resolution | null {
    const info = nearest(from, (directory) => packages.get(directory));
    if (!info) return null;

    for (const [pattern, value] of Object.entries(info.imports)) {
      const capture = matchPattern(pattern, specifier);
      const target = capture === null ? null : pickCondition(value);
      if (target && capture !== null) {
        const found = locate(normalize(join(info.directory, target.replace("*", capture))));
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * A package.json with a matching name proves nothing by itself: test fixtures often
   * reuse real package names. The repository must declare the package as a workspace.
   */
  function isProvenWorkspace(from: string, info: PackageInfo, name: string): boolean {
    const importer = nearest(from, (directory) => packages.get(directory));
    const declared = importer?.dependencies[name];
    if (typeof declared === "string" && declared.startsWith("workspace:")) return true;
    return workspacePatterns.some((pattern) => pattern.test(info.directory));
  }

  function resolveWorkspacePackage(from: string, specifier: string): Resolution | null | "missing" {
    const name = packageName(specifier);
    const matches = packagesByName.get(name);
    const info = matches?.length === 1 ? matches[0] : undefined;
    if (!info || !isProvenWorkspace(from, info, name)) return null;

    const subpath = specifier.slice(name.length + 1);
    const entry = packageEntry(info, subpath);
    const candidates = [
      entry && normalize(join(info.directory, entry)),
      subpath ? normalize(join(info.directory, subpath)) : null,
      subpath ? normalize(join(join(info.directory, "src"), subpath)) : null,
      subpath ? null : normalize(join(info.directory, "src/index")),
      subpath ? null : info.directory,
    ];

    for (const candidate of candidates) {
      const found = locate(candidate ?? null);
      if (found) return found;
    }
    return "missing";
  }

  function resolve(from: string, rawSpecifier: string): Resolution {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawSpecifier)) {
      return { kind: "external", packageName: rawSpecifier };
    }

    const specifier = rawSpecifier.split("?")[0] ?? rawSpecifier;
    const unresolved: Resolution = { kind: "unresolved" };

    if (specifier === "." || specifier === ".." || /^\.\.?\//.test(specifier)) {
      if (specifier === "." && from.split("/").length === 1) return unresolved;
      return locate(normalize(join(dirname(from), specifier))) ?? unresolved;
    }

    if (specifier.startsWith("#")) {
      return resolveSubpathImport(from, specifier) ?? unresolved;
    }

    const aliased = resolveAlias(from, specifier);
    if (aliased) return aliased;

    const workspace = resolveWorkspacePackage(from, specifier);
    if (workspace === "missing") return unresolved;
    if (workspace) return workspace;

    return isPackageSpecifier(specifier)
      ? { kind: "external", packageName: packageName(specifier) }
      : unresolved;
  }

  return { resolve };
}

function compiledCandidates(path: string): string[] {
  const extension = Object.keys(COMPILED_EXTENSIONS).find((e) => path.endsWith(e));
  if (!extension) return [];
  const base = path.slice(0, -extension.length);
  return (COMPILED_EXTENSIONS[extension] ?? []).map((replacement) => base + replacement);
}

function isPackageSpecifier(specifier: string): boolean {
  return /^(?:@[\w.-]+\/)?[\w.-]+(?:\/.*)?$/.test(specifier);
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function packageEntry(info: PackageInfo, subpath: string): string | null {
  const key = subpath ? `./${subpath}` : ".";
  const exportsField = info.exports;

  if (typeof exportsField === "string") return key === "." ? exportsField : null;
  if (isRecord(exportsField)) {
    const isSubpathMap = Object.keys(exportsField).some((k) => k.startsWith("."));
    const value = isSubpathMap ? exportsField[key] : key === "." ? exportsField : undefined;
    const entry = pickCondition(value);
    if (entry) return entry;
  }

  return key === "." ? (info.main ?? null) : null;
}

function pickCondition(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickCondition(item);
      if (picked) return picked;
    }
  }
  if (isRecord(value)) {
    for (const condition of CONDITIONS) {
      const picked = pickCondition(value[condition]);
      if (picked) return picked;
    }
  }
  return null;
}

/** Returns the text matched by `*`, an empty string for an exact match, or null. */
function matchPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (
    specifier.length < prefix.length + suffix.length ||
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix)
  ) {
    return null;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function readPackages(configs: Map<string, string>): Map<string, PackageInfo> {
  const packages = new Map<string, PackageInfo>();

  for (const [path, text] of configs) {
    if (!/(?:^|\/)package\.json$/.test(path)) continue;
    const json = readJson(text);
    if (!json) continue;

    packages.set(dirname(path), {
      directory: dirname(path),
      name: typeof json.name === "string" ? json.name : undefined,
      main: typeof json.main === "string" ? json.main : undefined,
      exports: json.exports,
      imports: isRecord(json.imports) ? json.imports : {},
      dependencies: {
        ...recordOf(json.peerDependencies),
        ...recordOf(json.devDependencies),
        ...recordOf(json.dependencies),
      },
    });
  }
  return packages;
}

function groupByName(packages: Map<string, PackageInfo>): Map<string, PackageInfo[]> {
  const byName = new Map<string, PackageInfo[]>();
  for (const info of packages.values()) {
    if (info.name) byName.set(info.name, [...(byName.get(info.name) ?? []), info]);
  }
  return byName;
}

/** Reads workspace folders from package.json and pnpm-workspace.yaml as path patterns. */
function readWorkspacePatterns(configs: Map<string, string>): RegExp[] {
  const patterns: RegExp[] = [];

  for (const [path, text] of configs) {
    const directory = dirname(path);
    let globs: unknown[] = [];

    if (/(?:^|\/)package\.json$/.test(path)) {
      const workspaces = readJson(text)?.workspaces;
      globs = Array.isArray(workspaces)
        ? workspaces
        : isRecord(workspaces) && Array.isArray(workspaces.packages)
          ? workspaces.packages
          : [];
    } else if (/(?:^|\/)pnpm-workspace\.yaml$/.test(path)) {
      globs = [...text.matchAll(/^\s*-\s*['"]?([^'"#\s]+)['"]?/gm)].map((match) => match[1]);
    }

    for (const glob of globs) {
      if (typeof glob === "string" && !glob.startsWith("!")) {
        patterns.push(globToPattern(join(directory, glob.replace(/^\.\//, ""))));
      }
    }
  }
  return patterns;
}

function globToPattern(glob: string): RegExp {
  const source = glob
    .replace(/\/$/, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]+")
    .replace(/\0/g, ".+");
  return new RegExp(`^${source}$`);
}

function readCompilerPaths(
  path: string,
  configs: Map<string, string>,
  seen = new Set<string>(),
): CompilerPaths {
  const empty: CompilerPaths = { aliases: [], baseDirectory: null };
  if (seen.has(path)) return empty;
  seen.add(path);

  const text = configs.get(path);
  const json = text === undefined ? null : readJson(text);
  if (!json) return empty;

  let result = empty;
  const parents = Array.isArray(json.extends) ? json.extends : [json.extends];
  for (const parent of parents) {
    if (typeof parent !== "string" || !parent.startsWith(".")) continue;
    const parentPath = normalize(join(dirname(path), parent));
    if (parentPath === null) continue;
    const withExtension = configs.has(parentPath) ? parentPath : `${parentPath}.json`;
    const inherited = readCompilerPaths(withExtension, configs, seen);
    result = {
      aliases: inherited.aliases.length ? inherited.aliases : result.aliases,
      baseDirectory: inherited.baseDirectory ?? result.baseDirectory,
    };
  }

  const options = isRecord(json.compilerOptions) ? json.compilerOptions : {};
  const directory = dirname(path);
  const baseDirectory =
    typeof options.baseUrl === "string" ? normalize(join(directory, options.baseUrl)) : null;

  if (isRecord(options.paths)) {
    const root = baseDirectory ?? directory;
    result = {
      ...result,
      aliases: Object.entries(options.paths).map(([pattern, targets]) => ({
        pattern,
        targets: (Array.isArray(targets) ? targets : [])
          .filter((target): target is string => typeof target === "string")
          .map((target) => join(root, target)),
      })),
    };
  }

  return baseDirectory === null ? result : { ...result, baseDirectory };
}

function readJson(text: string): Record<string, unknown> | null {
  const { config } = ts.parseConfigFileTextToJson("config.json", text);
  return isRecord(config) ? config : null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function join(directory: string, path: string): string {
  return directory ? `${directory}/${path}` : path;
}

/** Collapses `.` and `..`. Returns null for a path that leaves the repository. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}
