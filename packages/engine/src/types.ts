export type RelationshipType = "static" | "dynamic" | "reexport" | "type";

export type InputFile = {
  /** Path relative to the repository root, using forward slashes. */
  path: string;
  bytes: Uint8Array;
};

export type SourceFile = {
  path: string;
  content: string;
  size: number;
};

export type SkipReason = "excluded_directory" | "lock_file" | "binary" | "minified" | "too_large";

export type SkippedFile = { path: string; reason: SkipReason };

export type LimitExceeded = {
  kind: "source_files" | "total_bytes";
  limit: number;
  actual: number;
};

export type FileSet = {
  sources: SourceFile[];
  /** package.json, tsconfig.json and jsconfig.json, read as data for import resolution. */
  configs: Map<string, string>;
  /** Every path in the repository, so an import of a non-source file isn't called unresolved. */
  allPaths: Set<string>;
  skipped: SkippedFile[];
  limitExceeded: LimitExceeded | null;
};

export type ImportRecord = {
  specifier: string;
  type: RelationshipType;
  line: number;
};

export type UnanalyzableImport = {
  expression: string;
  line: number;
};

export type ParsedFile = {
  imports: ImportRecord[];
  exports: string[];
  unanalyzable: UnanalyzableImport[];
  hasSyntaxErrors: boolean;
};

export type Resolution =
  | { kind: "internal"; target: string }
  | { kind: "non_source"; target: string }
  | { kind: "external"; packageName: string }
  | { kind: "unresolved" };

export type DependencyEdge = {
  source: string;
  target: string;
  type: RelationshipType;
  specifier: string;
  line: number;
};

export type UnresolvedImport = {
  source: string;
  specifier: string;
  line: number;
};

export type FileMetrics = {
  path: string;
  language: string;
  size: number;
  lines: number;
  incoming: number;
  outgoing: number;
  exports: string[];
  hasSyntaxErrors: boolean;
};

export type LanguageStat = { language: string; files: number; lines: number };
export type DirectoryStat = { path: string; files: number };

export type AnalysisResult = {
  files: FileMetrics[];
  edges: DependencyEdge[];
  unresolved: UnresolvedImport[];
  unanalyzable: (UnanalyzableImport & { source: string })[];
  externalPackages: string[];
  /** Groups of files joined by a runtime import cycle. Type-only imports are left out. */
  cycles: string[][];
  languages: LanguageStat[];
  directories: DirectoryStat[];
  totals: {
    allFiles: number;
    directories: number;
    sourceFiles: number;
    lines: number;
    internalDependencies: number;
    unresolvedImports: number;
    skippedFiles: number;
  };
};
