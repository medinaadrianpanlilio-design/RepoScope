# Setting up the GitHub App

RepoScope reads private repositories through a GitHub App. A fresh install of RepoScope needs its own
App. Public repositories work without one.

Replace `<site>` below with the deployed address, such as `https://reposcope.example.com`.

## 1. Register the App

On GitHub, go to Settings > Developer settings > GitHub Apps > New GitHub App, then fill in:

| Setting | Value |
|---|---|
| Homepage URL | `<site>` |
| Callback URL | `<site>/api/github/callback` |
| Request user authorization (OAuth) during installation | On |
| Expire user authorization tokens | On (the default) |
| Webhook | Active |
| Webhook URL | `<site>/api/github/webhook` |
| Webhook secret | A long random value. Keep it for step 3 |
| Repository permissions | Contents: Read-only. Metadata: Read-only. Nothing else |
| Subscribe to events | Push, Repository |
| Where can this App be installed? | Only on this account, or any account if others will use it |

Keep the permissions exactly as listed. RepoScope asks for these two and nothing more when it requests
a token, and it refuses to read anything if an installation hasn't accepted them.

## 2. Collect the credentials

From the App's settings page:

- The **App's link name** (the end of `https://github.com/apps/<name>`).
- The **Client ID**.
- A new **client secret**. GitHub shows it once.
- A new **private key**, which downloads as a `.pem` file.

## 3. Add them to the server

Set these as server-only environment variables (on Vercel: Project > Settings > Environment Variables).
Never put them in the repository, in `.env.example`, or anywhere the browser can read.

| Variable | Value |
|---|---|
| `GITHUB_APP_SLUG` | The App's link name. The whole public link also works |
| `GITHUB_APP_CLIENT_ID` | The Client ID |
| `GITHUB_APP_CLIENT_SECRET` | The client secret |
| `GITHUB_APP_PRIVATE_KEY` | The whole contents of the `.pem` file. Newlines may be written as `\n` |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret from step 1 |

Redeploy afterwards so the server reads them.

## 4. Apply the database migrations

Run every file in `supabase/migrations/` in order, in the Supabase SQL editor. The App needs the
`github_installations` table, the `verified_repository_ids` column and the `analysis_snapshots` table.

## 5. Check it works

1. Sign in and open the dashboard. The GitHub section shows **Connect GitHub**. If it says the App isn't
   set up, a variable from step 3 is missing.
2. Click **Connect GitHub**, install the App on an account, and choose a repository.
3. If GitHub leaves you on its settings page instead of returning, use **Finish connecting** under the
   button.
4. The account appears with the status **Connected** and lists the chosen repositories. Open one.
5. Push to that repository's default branch. Within seconds its overview shows a new analysis. In the
   App's settings on GitHub, Advanced > Recent Deliveries shows each webhook and its response.

## What each part trusts

- **The callback** trusts nothing in its address. It links an installation only after GitHub confirms,
  with the user's own short-lived token, that the user can see every repository it reaches. See
  `docs/adr/0009`.
- **Webhooks** are checked against `GITHUB_WEBHOOK_SECRET` before anything in them is read. A push opens
  a private repository only through that repository's own installation.
- **Installation tokens** are created per request, limited to one repository, never stored and never
  logged.
- **Disconnect** removes RepoScope's record of an installation and everything read through it. The App
  stays installed on GitHub until its owner uninstalls it there.
