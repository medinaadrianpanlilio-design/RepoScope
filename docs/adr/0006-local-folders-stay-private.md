# Local folders stay private and separate

`reposcope sync` analyzes a folder on the owner's PC and uploads only the results: paths, line counts,
export names and dependency edges. Source never leaves the PC, so the upload format has no field that
could carry it, and the server refuses unknown fields.

- **A local folder is its own private Repository.** It is matched per user by git remote, or by
  `local/<folder>` when there is no remote. It is never merged into the shared public record of the
  same repository, because uncommitted work has to stay private and public results are readable by
  everyone. This changes the original plan, where a clone and its GitHub record were one Repository.
- **What this costs.** A person who has imported a public repository and also synced a clone sees two
  entries. The website can't show source or run local AI on a local folder, since the server has no
  source to send. Insight explanations still work, as they only use stored facts.
- **One Working copy per Repository,** replaced on every sync and removed once the folder is clean, so
  uncommitted analyses can't pile up.
- **Only the newest analysis counts.** A clean folder is up to date only if its commit is the newest
  completed analysis. Matching an older one isn't enough: switching back to a branch has to bring that
  branch's facts to the front, or an agent gets answers about the wrong code.
- **An upload is shown only when complete.** The server compares row counts before marking a run
  complete, so a broken upload never appears.

## Keys

MCP keys only read and sync keys only upload. Only a SHA-256 hash is stored, and the key is shown once.
A plain hash is enough because keys are 32 random bytes, so there is nothing to guess.

MCP tools run with the server client, which bypasses Row Level Security, so `repositoriesOf` is the
whole access check: a key reaches only what its owner saved. Every tool goes through `withRepository`,
and a new tool must too.

## Tested

Against the real database in November 2026, with two temporary accounts: 114 checks covering isolation
at the database, API, page and MCP layers, refused payloads, partial uploads, branch switching, revoked
keys and the session hook. Claude Code connected as a real client and called `get_impact`.
