# Where RepoScope is now

Last updated: 7 November 2026. Read this first when picking the project back up.

## In one line

Phase 1 is built but not deployed. Phase 2 is 11 of 12 tickets done: paste a repo link and watch it get
analyzed, with real stats on its overview page. The interactive graph comes in Phase 3.

## Done

**Phase 1: Foundation**

- Next.js app with sign up, sign in, sign out, a dashboard and a repository overview page
- Public repository import, with clear errors for bad links, missing repos and private repos
- Supabase schema with Row Level Security

**Phase 2: Analysis engine (tickets 01-11)**

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
  on real repositories, including simultaneous requests. Not yet run on Vercel, and a run killed by
  the time limit is covered by unit tests only.
- 11 Live progress screen, real overview stats, dashboard status and failure screens. Tested in a
  real browser.

Last results: 124 engine tests, 103 web tests and 7 browser tests pass, and the production build
passes. On microsoft/vscode, 158,879 imports showed 0 disagreements with TypeScript.

## Next

Remaining Phase 2 tickets, in order:

1. 12 Add the daily maintenance cron

Then Phase 3: the interactive graph. The full plan and build order are in `docs/spec.md`.

## Needs the owner

1. Deploy on Vercel. See the Deploy section of `README.md`. Deployment has not been tested yet.
2. Test a real sign-up and its confirmation email.
3. Add a `GITHUB_TOKEN` limited to public repositories, read-only. Without one, GitHub allows 60
   requests an hour.

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
- The repo is on an exFAT drive with no symlinks. See `docs/adr/0002`.
- Keep `typescript` on `^6`. See `docs/adr/0003`.
- `npm run setup` installs both `apps/web` and `packages/engine`. If npm fails with `EALLOWSCRIPTS`,
  the cause is an `allow-scripts` line in the user-level `~/.npmrc`; set `NPM_CONFIG_USERCONFIG` to an
  empty file for that command. On a fresh checkout, run `npx next typegen` in `apps/web` before
  `typecheck`.
- A stopped `next start` can keep running and hold its port. Check the port before trusting a test.
