import { describe, expect, it, vi } from "vitest";
import { analyzeFileSet, buildFileSet } from "../../engine/src/index.ts";
import { folderName, gitInfo, parseRemote } from "./git.ts";
import { withSessionHook } from "./hook.ts";
import { isReadable } from "./collect.ts";
import { uploadResult } from "./upload.ts";

describe("parseRemote", () => {
  it.each([
    ["https://github.com/owner/repo.git", "owner/repo"],
    ["https://github.com/owner/repo", "owner/repo"],
    ["git@github.com:owner/repo.git", "owner/repo"],
    ["ssh://git@github.com/owner/repo.git", "owner/repo"],
  ])("reads %s", (url, expected) => {
    expect(parseRemote(url)).toBe(expected);
  });

  it.each(["https://gitlab.com/owner/repo.git", "", "not a url", "https://github.com/owner"])(
    "ignores %s",
    (url) => {
      expect(parseRemote(url)).toBeNull();
    },
  );
});

describe("folderName", () => {
  it("keeps a usable name", () => {
    expect(folderName("E:\\coding practice")).toBe("coding-practice");
    expect(folderName("/home/me/my.app/")).toBe("my.app");
  });
});

describe("gitInfo", () => {
  const replies = (map: Record<string, string>) =>
    vi.fn(async (args: string[]) => {
      const key = Object.keys(map).find((k) => args.includes(k));
      if (key === undefined) throw new Error("no such thing");
      return map[key]!;
    });

  it("reads the commit, branch, remote and clean state", async () => {
    const run = replies({
      HEAD: "a".repeat(40) + "\n",
      "--abbrev-ref": "main\n",
      status: "",
      "get-url": "https://github.com/o/r.git\n",
    });
    // rev-parse is asked twice, and --abbrev-ref must win for the branch.
    run.mockImplementation(async (args: string[]) => {
      if (args.includes("--abbrev-ref")) return "main\n";
      if (args.includes("HEAD")) return "a".repeat(40) + "\n";
      if (args.includes("status")) return "";
      return "https://github.com/o/r.git\n";
    });

    expect(await gitInfo(run)).toEqual({
      commit: "a".repeat(40),
      branch: "main",
      dirty: false,
      remote: "o/r",
    });
  });

  it("doesn't count the settings file install-hook writes as an edit", async () => {
    const run = vi.fn(async (_args: string[]) => "a".repeat(40));
    await gitInfo(run);

    const status = run.mock.calls.map(([args]) => args).find((args) => args.includes("status"));
    expect(status).toContain(":(exclude).claude/settings.local.json");
  });

  it("notices uncommitted work", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes("status")) return " M src/a.ts\n";
      if (args.includes("get-url")) throw new Error("no remote");
      return args.includes("--abbrev-ref") ? "main\n" : "a".repeat(40) + "\n";
    });

    expect(await gitInfo(run)).toMatchObject({ dirty: true, remote: null });
  });

  it("treats a folder without git as a working copy", async () => {
    const run = vi.fn(async () => {
      throw new Error("not a git repository");
    });

    expect(await gitInfo(run)).toEqual({ commit: null, branch: null, dirty: true, remote: null });
  });
});

describe("isReadable", () => {
  it.each(["src/a.ts", "b.tsx", "package.json", "apps/web/tsconfig.json", "pnpm-workspace.yaml"])(
    "reads %s",
    (path) => {
      expect(isReadable(path)).toBe(true);
    },
  );

  it.each([".env", ".env.local", "secrets.pem", "logo.png", "notes.md"])("never reads %s", (path) => {
    expect(isReadable(path)).toBe(false);
  });
});

describe("withSessionHook", () => {
  const command = "node sync";

  it("adds the hook to empty settings", () => {
    expect(withSessionHook({}, command)).toEqual({
      hooks: {
        SessionStart: [{ matcher: "startup|resume", hooks: [{ type: "command", command }] }],
      },
    });
  });

  it("keeps everything else in the file", () => {
    const settings = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other" }] }], Stop: [] },
    };
    const result = withSessionHook(settings, command) as typeof settings;

    expect(result.permissions).toEqual(settings.permissions);
    expect(result.hooks.Stop).toEqual([]);
    expect(result.hooks.SessionStart).toHaveLength(2);
  });

  it("doesn't add the same hook twice", () => {
    const once = withSessionHook({}, command);

    expect(withSessionHook(once, command)).toEqual(once);
  });
});

describe("uploadResult", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const result = analyzeFileSet(
    buildFileSet([
      { path: "a.ts", bytes: bytes('import "./b";\nimport "./gone";\nconst secret = "hunter2";\n') },
      { path: "b.ts", bytes: bytes("export const b = 1;\n") },
    ]),
  );
  const start = { name: "app", remote: null, commit: null, branch: null, dirty: true };

  function server(startReply: unknown) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), body });
      return new Response(JSON.stringify({ data: calls.length === 1 ? startReply : { ok: true } }));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("stops when the server already has this commit", async () => {
    const { calls, fetchImpl } = server({ upToDate: true });
    const outcome = await uploadResult({ url: "https://x", key: "k", start, result, fetchImpl });

    expect(outcome).toEqual({ uploaded: false });
    expect(calls).toHaveLength(1);
  });

  it("uploads files, then connections, then completes with true counts", async () => {
    const { calls, fetchImpl } = server({ upToDate: false, runId: "run-1" });
    await uploadResult({ url: "https://x", key: "k", start, result, fetchImpl });

    expect(calls.slice(1).map((c) => c.body.kind)).toEqual(["files", "edges", "unresolved", "complete"]);
    expect(calls[1]?.url).toBe("https://x/api/sync/run-1");
    expect(calls.at(-1)?.body).toMatchObject({ files: 2, edges: 1, unresolved: 1 });
  });

  it("never sends source code", async () => {
    const { calls, fetchImpl } = server({ upToDate: false, runId: "run-1" });
    await uploadResult({ url: "https://x", key: "k", start, result, fetchImpl });

    expect(JSON.stringify(calls)).not.toContain("hunter2");
  });

  it("sends the key as a bearer token", async () => {
    const { fetchImpl } = server({ upToDate: true });
    await uploadResult({ url: "https://x", key: "rs_sync_abc", start, result, fetchImpl });

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer rs_sync_abc");
  });

  it("reports a refused key clearly", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "That sync key isn't valid." } }), { status: 401 }),
    ) as unknown as typeof fetch;

    await expect(
      uploadResult({ url: "https://x", key: "bad", start, result, fetchImpl }),
    ).rejects.toThrow("That sync key isn't valid.");
  });
});
