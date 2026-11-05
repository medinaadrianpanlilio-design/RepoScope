# Where RepoScope is now

Last updated: 5 November 2026. Read this first when picking the project back up.

## In one line

Phase 1 is built but not deployed. Phase 2 is 7 of 12 tickets done: the analysis engine works, but it
isn't connected to the app yet.

## Done

**Phase 1: Foundation**

- Next.js app with sign up, sign in, sign out, a dashboard and a repository overview page
- Public repository import, with clear errors for bad links, missing repos and private repos
- Supabase schema with Row Level Security

**Phase 2: Analysis engine (tickets 01-07)**

- 01 Rate limiting on import: 20 per hour per visitor, stored as a hash
- 02 `packages/engine`, wired into the web app
- 03 File filtering and limits
- 04 Import and export parsing
- 05 Import resolution: relative paths, aliases, `extends`, monorepos, `#imports`, workspace packages
- 06 Graph, cycles and metrics
- 07 Accuracy check against TypeScript's own resolver, recorded in `docs/adr/0004`

Last results: 114 engine tests and 55 web tests pass, and the production build passes. On
microsoft/vscode, 158,879 imports showed 0 disagreements with TypeScript.

## Next

Remaining Phase 2 tickets, in order:

1. 08 Download and extract archives safely
2. 09 Add the results schema
3. 10 Run analyses in the background
4. 11 Show real progress and stats
5. 12 Add the daily maintenance cron

Then Phase 3: the interactive graph. The full plan and build order are in `docs/spec.md`.

## Needs the owner

1. Put the Supabase secret key in `apps/web/.env.local` after `SUPABASE_SECRET_KEY=`. Never commit it
   or paste it into a chat. Import can't work without it, so a real import has not been tested yet.
2. Deploy on Vercel. See the Deploy section of `README.md`. Deployment has not been tested yet.
3. Test a real sign-up and its confirmation email.

## Open items

- Two harmless test rows are in the `rate_limits` table, with keys starting `test:`. Delete them, or
  let the Phase 2 cron clean up old rows.
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
- `npm run setup` installs both `apps/web` and `packages/engine`.
- A stopped `next start` can keep running and hold its port. Check the port before trusting a test.
