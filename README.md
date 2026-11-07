# RepoScope

**Understand any codebase. Visually.**

RepoScope builds a knowledge base of a repository from static analysis. People explore it as an
interactive architecture graph, and coding agents read the same knowledge through MCP. Analysis
decides the facts; AI only explains them.

> **Status: in development, and live at https://repo-scope-delta.vercel.app.** Public repositories,
> the graph, local AI, insights, change impact, local folders and MCP are built. See
> [status](docs/status.md) and [the spec](docs/spec.md).

## Run it

Needs Node.js 20.9 or newer and a Supabase project.

```sh
npm run setup
cp apps/web/.env.example apps/web/.env.local   # then fill in the values
npm run dev                                    # http://localhost:3000
```

Apply `supabase/migrations/` to your project. The variables are explained in
[`apps/web/.env.example`](apps/web/.env.example).

## Use it with Claude Code

Sign in and open **Connect Claude Code** on the dashboard. Create an MCP key and run the command it
shows. Then create a sync key and, with `npm run setup` done, run this from a project folder:

```sh
node path/to/RepoScope/packages/cli/src/index.ts login <sync key>
node path/to/RepoScope/packages/cli/src/index.ts sync
node path/to/RepoScope/packages/cli/src/index.ts install-hook   # optional: sync when a session starts
```

Needs Node.js 24, which runs the TypeScript directly. Only analysis results are uploaded. Your source
stays on your computer, and a local folder is private to you. See
[ADR 0006](docs/adr/0006-local-folders-stay-private.md).

## Check it

```sh
npm run typecheck
npm run lint
npm test
```

Browser tests run against a running server:

```sh
cd apps/web
npx playwright install chromium
E2E_BASE_URL=http://localhost:3000 npx playwright test
```

Signed-in tests also need `E2E_EMAIL` and `E2E_PASSWORD` for a confirmed test account.

## Deploy

Import the repository into Vercel, set **Root Directory** to `apps/web`, keep **Include files outside
the root directory** on, and add the variables from `.env.example`. In Supabase, under Authentication >
URL Configuration, set the Site URL to the deployed address and add `<address>/auth/callback` to the
redirect URLs.

## Stack

Next.js, TypeScript, Tailwind CSS, Supabase and Vercel, with the TypeScript Compiler API for analysis,
React Flow for the graph and MCP for coding agents. Decisions are recorded in [`docs/adr`](docs/adr).
