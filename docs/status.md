# Where RepoScope is now

Last updated: 7 November 2026. Read this first when picking the project back up.

## In one line

Phases 1, 2 and 3 are done, and the site is live at https://repo-scope-delta.vercel.app: paste a repo
link, watch it get analyzed, then explore it with the interactive graph, file explorer and dependency
inspector. Phase 4 is done too: file summaries and chat run on a model on your own PC. Next is Phase 5.

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

Last results: 125 engine tests and 228 web tests pass, and the production build passes. On
microsoft/vscode, 158,879 imports showed 0 disagreements with TypeScript.

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

## Next

Phase 5: Insights and change impact. Start at `.scratch/phase-5-insights-impact/spec.md`.

The full plan and build order are in `docs/spec.md`.

## Needs the owner

1. Confirm the daily job ran, in Vercel's logs after 18:00 UTC.
2. Add a `GITHUB_TOKEN` limited to public repositories, read-only, before sharing the site widely.
   Without one, GitHub allows 60 requests an hour for the whole site.

## Open items

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
- `npm run setup` installs both `apps/web` and `packages/engine`. If npm fails with `EALLOWSCRIPTS`,
  the cause is an `allow-scripts` line in the user-level `~/.npmrc`; set `NPM_CONFIG_USERCONFIG` to an
  empty file for that command. On a fresh checkout, run `npx next typegen` in `apps/web` before
  `typecheck`.
- A stopped `next start` can keep running and hold its port. Check the port before trusting a test.
