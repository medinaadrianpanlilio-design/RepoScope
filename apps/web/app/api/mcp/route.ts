import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { checkImportRules } from "@reposcope/engine";
import {
  foundPaths,
  namedOnly,
  PRIVATE_FILE_NOTE,
  readFoundConventions,
  REPOSITORY_CONTENT_LABEL,
} from "@/lib/conventions/found";
import { conventionsForFile, notesIn, rulesIn } from "@/lib/conventions/schema";
import { conventionsOf } from "@/lib/conventions/store";
import { riskReport } from "@/lib/graph/risk-input";
import { plannedRisks } from "@/lib/graph/risks";
import { verifyKey } from "@/lib/keys/store";
import {
  chooseRepository,
  dependentsOf,
  fileContext,
  findFile,
  impactOf,
  overviewOf,
  searchPaths,
} from "@/lib/mcp/answers";
import {
  loadKnowledge,
  repositoriesOf,
  type Knowledge,
  type KnownRepository,
} from "@/lib/mcp/knowledge";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

type Extra = { http?: { authInfo?: { extra?: Record<string, unknown> } } };

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function refusal(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Every tool goes through this, so none can reach a repository its key's owner didn't save, nor a
 * private one whose GitHub access has ended.
 */
async function withRepository<T>(
  extra: Extra,
  name: string,
  answer: (data: Knowledge, owner: { userId: string; repository: KnownRepository }) => T,
) {
  const userId = extra.http?.authInfo?.extra?.userId as string | undefined;
  if (!userId) return refusal("Not authorized.");

  const repositories = await repositoriesOf(userId);
  const repository = chooseRepository(repositories, name);
  if (!repository) {
    return refusal(
      `No repository matches "${name}". Yours: ${repositories.map((r) => r.full_name).join(", ") || "none"}.`,
    );
  }
  if (repository.unavailable) {
    return refusal(`${repository.full_name} can't be read right now. ${repository.unavailable}`);
  }

  const data = await loadKnowledge(repository.id);
  if (!data) return refusal(`${repository.full_name} has no analysis yet. Run reposcope sync.`);
  return answer(data, { userId, repository });
}

const repository = z.string().describe("Repository name, such as owner/name or just name");
const path = z.string().describe("File path from the repository root. A unique ending also works");

const notFound = (wanted: string, candidates: string[]) =>
  refusal(
    candidates.length
      ? `"${wanted}" is ambiguous. Did you mean: ${candidates.join(", ")}?`
      : `No analyzed file matches "${wanted}".`,
  );

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_repositories",
      {
        title: "List repositories",
        description: "Lists the repositories RepoScope knows about for this key.",
        inputSchema: z.object({}),
      },
      async (_args, extra) => {
        const userId = (extra as Extra).http?.authInfo?.extra?.userId as string | undefined;
        if (!userId) return refusal("Not authorized.");
        const repositories = await repositoriesOf(userId);
        return text(
          repositories.map(({ full_name, source, unavailable }) => ({
            name: full_name,
            source,
            ...(unavailable && { unavailable }),
          })),
        );
      },
    );

    server.registerTool(
      "get_overview",
      {
        title: "Get repository overview",
        description:
          "Start here instead of exploring folders. The repository's size, languages, main folders, most used files, entry points and packages, and which commit the facts describe.",
        inputSchema: z.object({ repository }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, (data) =>
          text(overviewOf(data, data.run.stats, data.run)),
        ),
    );

    server.registerTool(
      "get_file_context",
      {
        title: "Get file context",
        description:
          "Before editing a file: what it imports, what imports it, how far a change could reach, any import cycle, unresolved imports, and the owner's notes and rules for it. Facts come from static analysis.",
        inputSchema: z.object({ repository, path }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, async (data, { userId, repository: known }) => {
          const { file, candidates } = findFile(data, args.path);
          if (!file) return notFound(args.path, candidates);
          const conventions = await conventionsOf(userId, known.id);
          return text(fileContext(data, file, conventionsForFile(conventions, file.path)));
        }),
    );

    server.registerTool(
      "get_dependents",
      {
        title: "Get dependents",
        description: "Lists the files that directly import a file, with how they import it.",
        inputSchema: z.object({ repository, path }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, (data) => {
          const { file, candidates } = findFile(data, args.path);
          return file ? text(dependentsOf(data, file)) : notFound(args.path, candidates);
        }),
    );

    server.registerTool(
      "get_impact",
      {
        title: "Get change impact",
        description:
          "Lists every file that depends on the given files, directly or indirectly, nearest first. A listed file depends on this code but won't necessarily break.",
        inputSchema: z.object({ repository, paths: z.array(z.string()).min(1).max(50) }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, (data) => {
          const found = args.paths.map((wanted) => ({ wanted, ...findFile(data, wanted) }));
          const missing = found.find((item) => !item.file);
          if (missing) return notFound(missing.wanted, missing.candidates);
          return text(impactOf(data, found.flatMap((item) => (item.file ? [item.file] : []))));
        }),
    );

    server.registerTool(
      "search_files",
      {
        title: "Search files",
        description: "Finds analyzed files by part of their path.",
        inputSchema: z.object({ repository, query: z.string().min(1) }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, (data) => text(searchPaths(data, args.query))),
    );

    server.registerTool(
      "get_risks",
      {
        title: "Get risk warnings",
        description:
          "Pass paths, and any imports you plan to add, before making a change: warns about heavily used files, existing or new cycles, and the owner's import rules. Pass neither to see what's new in the latest analysis. A warning is a reason to look twice, not proof of a problem.",
        inputSchema: z.object({
          repository,
          paths: z.array(z.string()).max(50).optional(),
          newImports: z
            .array(z.object({ from: z.string(), to: z.string() }))
            .max(50)
            .optional()
            .describe("Imports you plan to add, as file paths. Files that don't exist yet are fine"),
        }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, async (data, { userId, repository: known }) => {
          const rules = rulesIn(await conventionsOf(userId, known.id));
          const paths = args.paths ?? [];
          const newImports = args.newImports ?? [];

          if (paths.length === 0 && newImports.length === 0) {
            return text((await riskReport(known.id, rules, createAdminClient())) ?? { warnings: [] });
          }

          const found = paths.map((wanted) => ({ wanted, ...findFile(data, wanted) }));
          const missing = found.find((item) => !item.file);
          if (missing) return notFound(missing.wanted, missing.candidates);

          const fullPath = (path: string) => findFile(data, path).file?.path ?? path;
          const warnings = plannedRisks({
            data,
            cycles: data.cycles,
            files: found.flatMap((item) => (item.file ? [item.file] : [])),
            imports: newImports.map(({ from, to }) => ({ from: fullPath(from), to: fullPath(to) })),
            rules,
          });
          return text(
            warnings.length > 0
              ? { warnings }
              : { warnings, note: "Nothing stood out. That isn't proof the change is safe." },
          );
        }),
    );

    server.registerTool(
      "get_conventions",
      {
        title: "Get conventions",
        description:
          "The owner's import rules and notes, with how many imports break each rule, and which AGENTS.md style files the repository has. Their contents are only sent if you ask, as you usually have them already.",
        inputSchema: z.object({
          repository,
          includeRepositoryFiles: z.boolean().optional().describe("Also send those files' contents"),
        }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, async (data, { userId, repository: known }) => {
          const conventions = await conventionsOf(userId, known.id);
          const rules = rulesIn(conventions);
          const paths = new Map(data.files.map((file) => [file.id, file.path]));
          const edges = data.edges.flatMap(({ source, target }) => {
            const from = paths.get(source);
            const to = paths.get(target);
            return from && to ? [{ source: from, target: to }] : [];
          });
          const violations = checkImportRules(edges, rules);
          const repositoryFiles = foundPaths(data.otherFiles, data.otherFileCount);

          return text({
            rules: rules.map((rule) => ({
              rule: rule.text,
              violations: violations.filter((v) => v.ruleId === rule.id).length,
            })),
            notes: notesIn(conventions).map(({ body, path }) => ({ path, note: body })),
            repositoryFiles: args.includeRepositoryFiles
              ? {
                  trust: REPOSITORY_CONTENT_LABEL,
                  files: known.installation_id
                    ? namedOnly(repositoryFiles, PRIVATE_FILE_NOTE)
                    : await readFoundConventions(
                        { ...known, commitSha: data.run.commitSha },
                        repositoryFiles,
                      ),
                }
              : repositoryFiles,
          });
        }),
    );
  },
  { serverInfo: { name: "RepoScope", version: "0.1.0" } },
);

const authorized = withMcpAuth(
  handler,
  async (_request, token) => {
    const userId = await verifyKey(token ?? null, "mcp");
    return userId
      ? { token: token as string, clientId: "reposcope-key", scopes: [], extra: { userId } }
      : undefined;
  },
  { required: true },
);

export { authorized as GET, authorized as POST };
