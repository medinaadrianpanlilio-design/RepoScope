import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyKey } from "@/lib/keys/store";
import { dependentsOf, fileContext, findFile, impactOf, searchPaths } from "@/lib/mcp/answers";
import { chooseRepository, loadKnowledge, repositoriesOf } from "@/lib/mcp/knowledge";

export const maxDuration = 60;

type Extra = { http?: { authInfo?: { extra?: Record<string, unknown> } } };

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function refusal(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Every tool goes through this, so none can reach a repository its key's owner didn't save. */
async function withRepository<T>(
  extra: Extra,
  name: string,
  answer: (data: NonNullable<Awaited<ReturnType<typeof loadKnowledge>>>) => T,
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

  const data = await loadKnowledge(repository.id);
  if (!data) return refusal(`${repository.full_name} has no analysis yet. Run reposcope sync.`);
  return answer(data);
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
        return text(repositories.map(({ full_name, source }) => ({ name: full_name, source })));
      },
    );

    server.registerTool(
      "get_file_context",
      {
        title: "Get file context",
        description:
          "Before editing a file: what it imports, what imports it, how far a change could reach, any import cycle, and unresolved imports. Facts come from static analysis.",
        inputSchema: z.object({ repository, path }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, (data) => {
          const { file, candidates } = findFile(data, args.path);
          return file ? text(fileContext(data, file)) : notFound(args.path, candidates);
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
      "get_conventions",
      {
        title: "Get conventions",
        description: "Lists the rules and notes saved for a repository.",
        inputSchema: z.object({ repository }),
      },
      async (args, extra) =>
        withRepository(extra as Extra, args.repository, () =>
          text({ conventions: [], note: "RepoScope doesn't store conventions yet." }),
        ),
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
