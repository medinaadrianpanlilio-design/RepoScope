# Where RepoScope is now

Last updated: 7 November 2026. Read this first when picking the project back up.

## In one line

Phases 1, 2 and 3 are done, and the site is live at https://repo-scope-delta.vercel.app: paste a repo
link, watch it get analyzed, then explore it with the interactive graph, file explorer and dependency
inspector. Phases 4 and 5 are done too: local AI summaries and chat, insights, and change impact.
Phases 6 and 7 are built and tested: local folders, `reposcope sync`, the MCP server, Conventions and
risk warnings. What's left of Phase 6 is the owner's one-week trial in real coding sessions.

## Done

**Phase 1: Foundation**

- Next.js app with sign up, sign in, sign out, a dashboard and a repository overview page
- Public repository import, with clear errors for bad links, missing repos and private repos
- Supabase schema with Row Level Security

**Phase 2: Analysis engine (all 12 tickets)**

- 01 Rate limiting on import: 20 per hour per visitor, stored as a hash
- 02 `packages/engine`, wired into the web app
- 03 File filtering and limits
- 04 Import and export parsing
- 05 Import resolution: relative paths, aliases, `extends`, monorepos, `#imports`, workspace packages
- 06 Graph, cycles and metrics
- 07 Accuracy check against TypeScript's own resolver, recorded in `docs/adr/0004`
- 08 Safe archive download and extraction: `downloadArchive` (web) only follows GitHub's redirect to
  codeload.github.com and caps bytes; `extractTarGz` (engine) works in memory, drops unsafe paths and
  links, and caps unpacked size and entry count. Not yet measured on Vercel or a real repo.
- 09 Results schema: files, Dependency edges, Unresolved imports and run statistics. No source code
  columns. Results of private repos are hidden, and only the server can write.
- 10 Background analysis: `POST /api/repositories/[id]/analyze` and `GET /api/analysis/[id]`. Tested
  on real repositories, including simultaneous requests, and on Vercel with repositories of up to
  130 source files. A run killed by the time limit is covered by unit tests only.
- 11 Live progress screen, real overview stats, dashboard status and failure screens. Tested in a
  real browser.
- 12 Daily maintenance at `/api/cron/daily`, protected by `CRON_SECRET`. Tested locally against the
  real database. The Vercel schedule itself has not run yet.

Last results: 125 engine tests, 256 web tests and 15 browser tests pass, and the production build
passes. On microsoft/vscode, 158,879 imports showed 0 disagreements with TypeScript.

**Phase 3: Visualization (all 10 tickets)**

- 01-04 Graph data API, React Flow and ELK canvas, node and edge styles, search, highlighting and
  filters
- 05 Folder grouping above 200 files, measured near the 2,000-file limit in `docs/adr/0004`.
- 06 Source on demand at `GET /api/analysis/[id]/files/[fileId]`, highlighted with Shiki. Nothing is
  stored.
- 07 File panel: details, cycle warning, clickable imports and importers, and the source.
- 08 Explorer page: file tree, search, extension filter, source, connections and exports, with links
  to and from the graph. Non-code files are listed and open on GitHub.
- 09 Dependency inspector, shared by the graph panel and explorer: direct and indirect reach, depth,
  cycle warnings and unresolved imports.
- 10 Resizable and collapsible panels, keyboard use across the graph and explorer, and browser tests
  in `apps/web/e2e/repository.spec.ts`.

**Phase 4: Local AI (all 8 tickets)**

- 01 Qwen3.5-4B is in `E:\tools\models`, and is the instruction-tuned model.
- 02 Browsers can reach local AI from the deployed site. See `docs/adr/0005`.
- 03, 06, 07 Setup screen, chat context and repo chat, with prompt-injection tests.
- 04, 05 File summaries, saved privately per user, with corrections kept as future training data.
- 08 Quality measured: see `docs/adr/0005`.

**Phase 5: Insights and change impact (all 7 tickets)**

- Insights are computed on demand from the saved analysis, in `apps/web/lib/graph/insights.ts`, so no
  table is needed and rule changes reach old analyses.
- Change impact is on the graph, from the file panel, and works across several files.
- The overview has an architecture summary, and local AI can explain an insight.

**Phase 6: Local folders, sync and MCP (tickets 01-08 of 9)**

- Local folders are private Repositories, separate from any public record. See `docs/adr/0006`.
- Keys are managed on the dashboard, in `apps/web/lib/keys`. MCP keys read, sync keys upload.
- `packages/cli` has `login`, `sync` and `install-hook`. The hook syncs when a session starts or
  resumes, in the background, and logs to `~/.reposcope/sync.log`.
- `/api/mcp` has six tools. `get_conventions` honestly returns nothing until Phase 7.
- Tested on the real database with two temporary accounts: 114 checks, and Claude Code as a real
  client. That testing found three bugs, now fixed: a removed folder never came back, switching
  branches left the other branch's facts showing, and the hook's settings file made a folder always
  look edited.
- Local folders on the site have no source view, exports list or per-file AI. Insight explanations work.

**Phase 7: Conventions and risk warnings (all 6 tickets, plus `get_overview`)**

- Import rules and notes are private per user, on the Conventions tab. See `docs/adr/0007`.
- Broken rules and risk warnings are computed on demand, so there's no table for them and no job to
  run after an analysis. `packages/engine/src/rules.ts` checks rules, and `lib/graph/risks.ts` holds
  the warnings.
- The overview shows what's new since the last analysis. `get_risks` checks a planned change first.
- `get_overview` replaces exploring a repository at the start of a session. Measured savings are in
  `docs/adr/0007`.
- Tested on the real database with two temporary accounts: 63 checks, including breaking a rule on
  purpose, and privacy between two users sharing a public repository. That testing found a bug from
  Phase 6, now fixed: with a public record and a synced clone of the same repository, every MCP tool
  refused the name. A synced clone now wins.

Last results: 164 engine tests, 31 CLI tests, 341 web tests and 18 browser tests pass.

**Phase 8: GitHub App and webhooks (in progress)**

- 02 The schema is done: `github_installations`, and private GitHub rows with one owner. See
  `docs/adr/0008`. `e2e/private-access.spec.ts` proves it on the real database, across every table.
- Writing it found a bug from Phase 6: anyone holding a local folder's id could save it, and MCP would
  then serve it to them. Fixed in the migration and in `repositoriesOf`.
- 03 The token service is built, in `lib/github/app-auth.ts` and `installation-tokens.ts`. Tokens can't
  print or serialize, and live in memory for one job. Real tokens are now issued on the live site.
- 04 Connect GitHub is built: the dashboard's GitHub section, `/api/github/connect` and
  `/api/github/callback`. See `docs/adr/0009`. Proven on the live site on 2026-11-09: the owner's
  installation linked after the real code exchange, user-side checks and an installation token.
- Once the App is installed, Connect GitHub leads to GitHub's settings, which don't come back. Opening
  `/api/github/callback` directly finishes connecting. Ticket 08 adds a link for this.
- 05 Private repositories import, analyze and show source. A pasted link that the server can't see is
  looked up through the user's own Installation, and the dashboard's GitHub list has an Open button.
  Analysis, source and found conventions all read through one `RepositoryReader`, so public and private
  repositories take the same steps. A private one gets a new token per request, limited to that one
  repository, so GitHub rechecks access every time. Private source comes from the contents API, so the
  token only goes to GitHub's API. A public row that went private is converted, and other users' saved
  copies are removed. Checked on the real database: conversion, a second owner refused, two racing
  imports giving one row. Proven on the live site on 2026-11-09 with a real private repository.
- 06 Webhooks arrive at `/api/github/webhook`, checked against `GITHUB_WEBHOOK_SECRET` before anything
  is read. A push to the default branch starts an analysis, and a repeated delivery finds the same run.
  Uninstalls, suspensions, removed repositories, renames, deletions and visibility changes update the
  database. Each Installation now keeps the repositories its user was checked against when connecting
  (`verified_repository_ids`), and nothing else opens through it, so an organization owner widening an
  Installation can't expose a repository the user can't see. Checked on the real database (9 checks)
  and with signed and unsigned deliveries to a local server. Proven on the live site on 2026-11-09: a
  push to a private repository's main branch was analyzed on its own within seconds.

Last results: 164 engine tests, 31 CLI tests, 484 web tests and 16 database tests pass.

## Next

1. Ticket 07: analyze only what changed.
2. Ticket 09 of Phase 6: use RepoScope for a week in real sessions, at
   `.scratch/phase-6-mcp/issues/09-daily-trial.md`.

The full plan and build order are in `docs/spec.md`.

## Needs the owner

1. Confirm the daily job ran, in Vercel's logs after 18:00 UTC.
2. Add a `GITHUB_TOKEN` limited to public repositories, read-only, before sharing the site widely.
   Without one, GitHub allows 60 requests an hour for the whole site.

## Open items

- There's no limit on how many folders one account can sync. Fine for now, but add one before inviting
  other people, as the free database is small.
- The CLI runs from a checkout of this repo, on Node 24. Publishing it to npm is a Phase 9 question.
- Database changes are run by hand in the Supabase SQL editor, in the order of `supabase/migrations/`.
- Supabase reports "RLS enabled, no policy" for `rate_limits`. That is intentional: only the server
  may reach that table.
- Decide whether to rewrite the first commit, which has a co-author line, and whether to hide the
  commit email behind GitHub's noreply address.
- Signed-in browser tests need a confirmed test account, set through `E2E_EMAIL` and `E2E_PASSWORD`.

## Good to know

- Tickets and specs are in `.scratch/`, starting at `.scratch/roadmap.md`. That folder is git-ignored,
  so it exists only on this PC. Back it up if the drive matters.
- The repo is on an exFAT drive with no symlinks. See `docs/adr/0002`. A build that fails with "failed
  to create junction point" needs that package added to `transpilePackages`.
- Install packages with `npm install <name> --prefix apps/web`, then check it landed there.
- Keep `typescript` on `^6`. See `docs/adr/0003`.
- Raise `ANALYSIS_VERSION` in `apps/web/lib/analysis/claim.ts` when results gain new data. Check for
  new commits then refreshes older analyses.
- `npm run setup` installs `apps/web`, `packages/engine` and `packages/cli`. If npm fails with `EALLOWSCRIPTS`,
  the cause is an `allow-scripts` line in the user-level `~/.npmrc`; set `NPM_CONFIG_USERCONFIG` to an
  empty file for that command. On a fresh checkout, run `npx next typegen` in `apps/web` before
  `typecheck`.
- A stopped `next start` can keep running and hold its port. Check the port before trusting a test.
