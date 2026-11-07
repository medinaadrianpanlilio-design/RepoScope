import { z } from "zod";

export const MAX_FILES_PER_CHUNK = 500;
export const MAX_EDGES_PER_CHUNK = 2000;

const MAX_PATH = 1024;
const MAX_SPECIFIER = 1024;
const MAX_NAME = 300;
const MAX_EXPORTS = 2000;

const count = z.number().int().nonnegative();

/** A repository-relative path. Nothing here has room for a file's contents. */
const path = z
  .string()
  .min(1)
  .max(MAX_PATH)
  .refine((value) => {
    const parts = value.split("/");
    return !value.startsWith("/") && !value.includes("\\") && !parts.includes("..");
  });

const commit = z.string().regex(/^[0-9a-f]{40}$/);

export const startSchema = z.strictObject({
  name: z.string().regex(/^[\w.-]{1,100}$/),
  remote: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/).nullable(),
  commit: commit.nullable(),
  branch: z.string().min(1).max(250).nullable(),
  dirty: z.boolean(),
});

const fileRow = z.strictObject({
  path,
  language: z.string().min(1).max(40),
  size: count,
  lines: count,
  incoming: count,
  outgoing: count,
  exports: z.array(z.string().max(MAX_NAME)).max(MAX_EXPORTS),
  hasSyntaxErrors: z.boolean(),
});

const edgeRow = z.strictObject({
  source: path,
  target: path,
  type: z.enum(["static", "dynamic", "reexport", "type"]),
  specifier: z.string().min(1).max(MAX_SPECIFIER),
  line: z.number().int().positive(),
});

const unresolvedRow = z.strictObject({
  source: path,
  specifier: z.string().min(1).max(MAX_SPECIFIER),
  line: z.number().int().positive(),
});

const statsSchema = z.strictObject({
  totals: z.strictObject({
    allFiles: count,
    directories: count,
    sourceFiles: count,
    lines: count,
    internalDependencies: count,
    unresolvedImports: count,
    skippedFiles: count,
  }),
  languages: z
    .array(z.strictObject({ language: z.string().max(40), files: count, lines: count }))
    .max(20),
  directories: z.array(z.strictObject({ path, files: count })).max(50),
  cycles: z.array(z.array(path).max(5000)).max(100),
  cycleCount: count,
  otherFiles: z.array(path).max(5000),
  otherFileCount: count,
  externalPackages: z.array(z.string().max(MAX_SPECIFIER)).max(5000),
  unanalyzable: z
    .array(
      z.strictObject({
        source: path,
        expression: z.string().max(200),
        line: z.number().int().positive(),
      }),
    )
    .max(100),
  unanalyzableCount: count,
});

export const chunkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("files"), rows: z.array(fileRow).max(MAX_FILES_PER_CHUNK) }),
  z.strictObject({ kind: z.literal("edges"), rows: z.array(edgeRow).max(MAX_EDGES_PER_CHUNK) }),
  z.strictObject({
    kind: z.literal("unresolved"),
    rows: z.array(unresolvedRow).max(MAX_EDGES_PER_CHUNK),
  }),
  z.strictObject({
    kind: z.literal("complete"),
    files: count,
    edges: count,
    unresolved: count,
    stats: statsSchema,
  }),
]);

export type SyncStart = z.infer<typeof startSchema>;
export type SyncChunk = z.infer<typeof chunkSchema>;
