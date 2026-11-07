import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * Proves private Repositories stay private, on a real database, with no browser involved.
 * It creates two temporary accounts and removes them afterwards.
 * Apply every migration first, then set E2E_DATABASE=1 and run `npm run e2e -- private-access`.
 */
const enabled = Boolean(process.env.E2E_DATABASE);
if (enabled) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const password = `t-${randomBytes(16).toString("hex")}`;
const tag = randomBytes(4).toString("hex");

type Account = { id: string; email: string; token: string };
type Seeded = { repository: string; run: string };
type Result = { status: number; rows: Record<string, unknown>[]; code?: string };

async function call(path: string, key: string, token: string, init: RequestInit = {}): Promise<Result> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : [];
  return {
    status: response.status,
    rows: Array.isArray(body) ? body : [],
    code: Array.isArray(body) ? undefined : body.code,
  };
}

const server = (path: string, init?: RequestInit) => call(path, secretKey, secretKey, init);
const anonymous = (path: string, init?: RequestInit) => call(path, publicKey, publicKey, init);
const as = (account: Account, path: string, init?: RequestInit) =>
  call(path, publicKey, account.token, init);
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

async function insert(table: string, body: unknown) {
  const result = await server(table, post(body));
  expect(result.status, `seeding ${table}: ${result.code}`).toBe(201);
  return result.rows;
}

async function createAccount(name: string): Promise<Account> {
  const email = `e2e-${name}-${tag}@reposcope.test`;
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const { id } = (await created.json()) as { id: string };

  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publicKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { access_token: token } = (await login.json()) as { access_token: string };
  return { id, email, token };
}

function deleteAccount(account: Account) {
  return fetch(`${url}/auth/v1/admin/users/${account.id}`, {
    method: "DELETE",
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
}

const githubId = () => 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const sha = () => randomBytes(20).toString("hex");

const repositoryFields = (fullName = `e2e-${tag}/private`) => ({
  owner: fullName.split("/")[0],
  name: fullName.split("/")[1],
  full_name: fullName,
  github_url: `https://github.com/${fullName}`,
  default_branch: "main",
});

/** One row in every table that holds something about a Repository. */
async function seedResults(owner: Account, repository: string): Promise<Seeded> {
  const [run] = await insert("analysis_runs", {
    repository_id: repository,
    commit_sha: sha(),
    status: "completed",
  });
  const analysis_id = run!.id as string;
  const file = { analysis_id, language: "typescript", file_size: 1, line_count: 1 };
  const [a, b] = await insert("repository_files", [
    { ...file, file_path: "a.ts" },
    { ...file, file_path: "b.ts" },
  ]);
  const line = { analysis_id, source_file_id: a!.id, line_number: 1 };
  await insert("dependency_edges", {
    ...line,
    target_file_id: b!.id,
    relationship_type: "static",
    import_specifier: "./b",
  });
  await insert("unresolved_imports", { ...line, import_specifier: "./gone" });
  await insert("ai_summaries", {
    user_id: owner.id,
    analysis_id,
    file_path: "a.ts",
    summary: "Private.",
    model: "test",
  });
  await insert("conventions", {
    user_id: owner.id,
    repository_id: repository,
    kind: "note",
    note_body: "Private.",
  });
  await insert("saved_repositories", { user_id: owner.id, repository_id: repository });
  return { repository, run: analysis_id };
}

/** Every table in the database. A new table fails the coverage test until it's listed here. */
function queries({ repository, run }: Seeded, owner: Account, installation: string) {
  return {
    repositories: `repositories?id=eq.${repository}`,
    analysis_runs: `analysis_runs?id=eq.${run}`,
    repository_files: `repository_files?analysis_id=eq.${run}`,
    dependency_edges: `dependency_edges?analysis_id=eq.${run}`,
    unresolved_imports: `unresolved_imports?analysis_id=eq.${run}`,
    ai_summaries: `ai_summaries?analysis_id=eq.${run}`,
    conventions: `conventions?repository_id=eq.${repository}`,
    saved_repositories: `saved_repositories?repository_id=eq.${repository}`,
    github_installations: `github_installations?id=eq.${installation}`,
    api_keys: `api_keys?user_id=eq.${owner.id}`,
    profiles: `profiles?id=eq.${owner.id}`,
    rate_limits: `rate_limits?key=eq.e2e-${tag}`,
  };
}

/** Tables with no grant for this role refuse outright, which hides the rows just as well. */
function expectHidden(result: Result, table: string) {
  expect([200, 401, 403], table).toContain(result.status);
  expect(result.rows, table).toEqual([]);
}

function expectRefused(result: Result) {
  expect([401, 403]).toContain(result.status);
  expect(result.rows).toEqual([]);
}

/** Row Level Security can answer 200 and change nothing, so this checks the row itself. */
async function expectUnchanged(account: Account, path: string, init: RequestInit) {
  const before = (await server(path)).rows;
  expect(before.length).toBe(1);

  const result = await as(account, path, init);
  expect(result.rows).toEqual([]);
  expect((await server(path)).rows).toEqual(before);
}

test.describe("private repositories", () => {
  test.skip(!enabled, "Set E2E_DATABASE=1 to run against the real database.");
  test.describe.configure({ mode: "serial" });

  let owner: Account;
  let other: Account;
  let installation: string;
  let publicRepository: string | undefined;
  const seeded = {} as Record<"github" | "local", Seeded>;

  test.beforeAll(async () => {
    owner = await createAccount("owner");
    other = await createAccount("other");

    const [row] = await insert("github_installations", {
      user_id: owner.id,
      github_installation_id: githubId(),
      account_login: `e2e-${tag}`,
      account_type: "User",
    });
    installation = row!.id as string;
    await insert("api_keys", {
      user_id: owner.id,
      kind: "mcp",
      name: "test",
      key_hash: sha(),
      key_prefix: "test",
    });

    const [github] = await insert("repositories", {
      ...repositoryFields(),
      github_id: githubId(),
      is_private: true,
      owner_user_id: owner.id,
      installation_id: installation,
    });
    // The same name on purpose: a synced clone sits beside the private repository it came from.
    const [local] = await insert("repositories", {
      ...repositoryFields(),
      source: "local",
      is_private: true,
      owner_user_id: owner.id,
    });
    seeded.github = await seedResults(owner, github!.id as string);
    seeded.local = await seedResults(owner, local!.id as string);
  });

  test.afterAll(async () => {
    if (publicRepository) await server(`repositories?id=eq.${publicRepository}`, { method: "DELETE" });
    await Promise.all([owner, other].filter(Boolean).map(deleteAccount));
  });

  test("covers every table in the database", async () => {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
        accept: "application/openapi+json",
      },
    });
    const { paths } = (await response.json()) as { paths: Record<string, unknown> };
    const tables = Object.keys(paths)
      .filter((path) => path !== "/" && !path.startsWith("/rpc/"))
      .map((path) => path.slice(1));

    expect(tables.sort()).toEqual(Object.keys(queries(seeded.github, owner, installation)).sort());
  });

  for (const kind of ["github", "local"] as const) {
    test(`hides a private ${kind} repository from every other reader`, async () => {
      for (const [table, query] of Object.entries(queries(seeded[kind], owner, installation))) {
        expectHidden(await anonymous(query), `${table} for a visitor`);
        expectHidden(await as(other, query), `${table} for another user`);
      }
    });

    test(`shows a private ${kind} repository to its owner`, async () => {
      const everything = queries(seeded[kind], owner, installation);
      const owned = Object.entries(everything).filter(([table]) => table !== "rate_limits");
      for (const [table, query] of owned) {
        const { rows } = await as(owner, query);
        expect(rows.length, table).toBeGreaterThan(0);
      }
    });

    test(`refuses another user saving a private ${kind} repository`, async () => {
      const save = { user_id: other.id, repository_id: seeded[kind].repository };
      expectRefused(await as(other, "saved_repositories", post(save)));

      const { rows } = await server(`saved_repositories?user_id=eq.${other.id}`);
      expect(rows).toEqual([]);
    });

    test(`refuses another user adding a note to a private ${kind} repository`, async () => {
      const note = {
        user_id: other.id,
        repository_id: seeded[kind].repository,
        kind: "note",
        note_body: "Probe.",
      };
      expectRefused(await as(other, "conventions", post(note)));
    });
  }

  test("still shows public repositories to everyone", async () => {
    const [row] = await insert("repositories", {
      ...repositoryFields(`e2e-${tag}/public`),
      github_id: githubId(),
    });
    publicRepository = row!.id as string;
    const shared = queries(await seedResults(owner, publicRepository), owner, installation);

    for (const query of [
      shared.repositories,
      shared.analysis_runs,
      shared.repository_files,
      shared.dependency_edges,
    ]) {
      expect((await anonymous(query)).rows.length, query).toBeGreaterThan(0);
    }
    const save = { user_id: other.id, repository_id: publicRepository };
    expect((await as(other, "saved_repositories", post(save))).status).toBe(201);
  });

  test("lets only the server write installations", async () => {
    const claim = {
      user_id: other.id,
      github_installation_id: githubId(),
      account_login: "probe",
      account_type: "User",
    };
    expectRefused(await as(other, "github_installations", post(claim)));

    const row = `github_installations?id=eq.${installation}`;
    await expectUnchanged(owner, row, patch({ account_login: "changed" }));
    await expectUnchanged(owner, row, { method: "DELETE" });
    await expectUnchanged(other, row, patch({ user_id: other.id }));
  });

  test("won't let an owner change their repository's privacy", async () => {
    const row = `repositories?id=eq.${seeded.github.repository}`;
    await expectUnchanged(owner, row, patch({ is_private: false }));
  });

  test("won't let the server open a private repository by mistake", async () => {
    const row = `repositories?id=eq.${seeded.github.repository}`;
    const result = await server(row, patch({ is_private: false }));
    expect(result.code).toBe("23514");

    const [stored] = (await server(row)).rows;
    expect(stored!.is_private).toBe(true);
  });

  test("refuses a private repository with no owner or no installation", async () => {
    const fields = { ...repositoryFields(`e2e-${tag}/shape`), github_id: githubId(), is_private: true };

    expect((await server("repositories", post(fields))).code).toBe("23514");
    expect((await server("repositories", post({ ...fields, owner_user_id: owner.id }))).code).toBe(
      "23514",
    );
  });

  test("refuses a repository owned by someone other than its installation's user", async () => {
    const stolen = {
      ...repositoryFields(`e2e-${tag}/stolen`),
      github_id: githubId(),
      is_private: true,
      owner_user_id: other.id,
      installation_id: installation,
    };
    expect((await server("repositories", post(stolen))).code).toBe("23503");
  });

  test("removing an installation removes its repositories and their results", async () => {
    await server(`github_installations?id=eq.${installation}`, { method: "DELETE" });

    const { repository, run } = seeded.github;
    expect((await server(`repositories?id=eq.${repository}`)).rows).toEqual([]);
    expect((await server(`repository_files?analysis_id=eq.${run}`)).rows).toEqual([]);
    expect((await server(`repositories?id=eq.${seeded.local.repository}`)).rows.length).toBe(1);
  });
});
