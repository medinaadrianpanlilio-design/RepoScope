# A private repository has one owner

GitHub installs an App once per account. An Installation here belongs to one user, so a private
Repository reached through it has exactly one owner. Its row sets `owner_user_id`, the same as a Local
folder, and reuses the owner policies from Phase 6. No new read policy was needed, and no results table
changed.

The alternative was one shared row plus a table of who may read it. That would let teammates share an
analysis, but every read would depend on keeping that table correct, and a mistake exposes private code.

- **A second person can't connect the same account.** A teammate on an organization's Installation is
  refused for now. Allowing it later means changing `github_installations` and how webhooks find a user.
- **The database keeps the shape honest.** A row is private exactly when it has an owner, and its owner
  must match its Installation's user. A public import can't reopen a private row by mistake: the update
  is refused, even for the server.
- **Only the server writes Installations.** Writing a row would claim an Installation, so users can read
  theirs and nothing more.
- **Removing an Installation removes its Repositories and their results.** Revoked access is recorded
  in `revoked_at` first, so the interface can explain what happened.
- **Saving a Repository needs permission to see it.** A foreign key ignores Row Level Security, so
  before this, anyone holding a private Repository's id could save it, and MCP would serve it to them.
  `repositoriesOf` now checks ownership too, because a shared row can become someone's private one after
  others saved it.

`e2e/private-access.spec.ts` checks every table on a real database, and fails when a new table isn't
listed in it.
