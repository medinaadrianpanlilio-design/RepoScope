# RepoScope

**Understand any codebase. Visually.**

RepoScope builds a knowledge base of a repository from static analysis. People explore it as an
interactive architecture graph, and coding agents read the same knowledge through MCP. Analysis
decides the facts; AI only explains them.

> **Status: early development.** Accounts, the dashboard and public repository import are built, and the
> analysis engine works on its own. See [status](docs/status.md) and [the spec](docs/spec.md).

## Run it

Needs Node.js 20.9 or newer and a Supabase project.

```sh
npm run setup
cp apps/web/.env.example apps/web/.env.local   # then fill in the values
npm run dev                                    # http://localhost:3000
```

Apply `supabase/migrations/` to your project. The variables are explained in
[`apps/web/.env.example`](apps/web/.env.example).

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

Next.js, TypeScript, Tailwind CSS, Supabase and Vercel, with the TypeScript Compiler API and React
Flow coming in the next phases. Decisions are recorded in [`docs/adr`](docs/adr).
