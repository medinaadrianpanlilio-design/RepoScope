# RepoScope spec

RepoScope builds a knowledge base of each repository and keeps it current. People explore that
knowledge visually. Coding agents read the same knowledge through MCP, without GitHub credentials.
The graph is the human view; MCP is the agent view.

**Main rule:** static analysis decides the facts, and AI only explains them. No fake data, no
invented relationships, no simulated progress. If something can't be determined, say so.

Goals: a portfolio piece that is also used every day in real coding sessions. ₱0 running cost,
non-commercial, no deadline.

## Build order

Tests and deploys happen in every phase. Each phase starts with `.scratch` issues and is built
test-first.

1. **Foundation:** Next.js, Supabase, login, basic dashboard, public repo import, auto-deploy
2. **Engine:** parse JS/TS, resolve imports, find cycles, save results
3. **Visualization:** graph, file panel, explorer, dependency inspector
4. **Local AI:** browser-to-localhost test first, then file summaries and chat
5. **Insights + change impact analysis,** plus AI explanations of insights
6. **MCP server + API keys** (daily use starts here, through local folders)
7. **Conventions and notes + risk warnings**
8. **GitHub App (private repos) + webhook sync**
9. **Polish:** full landing page, extra layouts, big-repo performance, README, demo video

## Decisions

| Area | Decision |
|---|---|
| Hosting | Vercel + Supabase (Singapore), free plans, non-commercial |
| Login | None for analyzing public repos. Required for the dashboard, private repos and keys |
| Getting code | One archive download per analysis. Tokens stay on the server |
| Source code | Raw source is never stored. It is fetched at the analyzed commit when opened |
| Running analyses | One Vercel function per analysis, using `after()`, capped near 2,000 JS/TS files (configurable). Move to Vercel Workflows if real repos hit the 300 s limit |
| Local folders | Results save to the same account, marked Local folder. Source stays on the PC |
| Same repo twice | A folder with a GitHub remote is the same repo. The same commit is never analyzed twice. Uncommitted work is a separate Working copy analysis |
| Staying current | `reposcope sync` from a Claude Code SessionStart hook, a Sync button, and webhooks on the live site. Opening a repo checks for newer commits, because GitHub doesn't retry failed webhooks |
| AI | Bring your own local AI: the browser calls `llama-server` (or Ollama) on the viewer's own PC. The app works fully without it. Safari is unsupported |
| Model | Qwen3.5-4B Instruct through the OpenAI-style chat API. Swapping in a fine-tune is a setting |
| AI output | File summaries (on click, then saved), insight explanations, repo chat. Summaries are private to whoever generated them |
| Chat grounding | Analysis results plus the selected file and its direct neighbors. It names its sources and says "I can't tell from this" |
| MCP keys | Read-only, hashed, revocable. OAuth only if a claude.ai connector is wanted later |
| Sync keys | Separate key that can only upload analysis results for the owner's repos |
| Conventions | Written in RepoScope, private to the user. Import rules are checked against the graph; free-text notes go to agents. Files like AGENTS.md appear as read-only found conventions |
| History | Full data for the latest 5 analyses per repo, summary numbers for older ones. Unsaved public analyses are deleted after 30 days |
| Big repos | Above about 200 files the graph opens grouped by folder |
| Keep-alive | A daily Vercel cron touches the database so the free Supabase project doesn't pause |
| Compiler | `typescript@^6`. Version 7 has no classic Compiler API. Revisit when its new API is stable |

## Features

**Analysis engine.** A separate package whose input is a set of files, so GitHub archives and local
folders share one pipeline. It extracts imports and exports with the TypeScript Compiler API;
resolves relative imports, index files, common extensions and path aliases; reports unresolved
imports separately; finds cycles with strongly connected components; and computes metrics.
Supports TS, TSX, JS and JSX first.

Excluded: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `vendor`, binary
files, minified bundles, lock files and oversized files. Exclusions are configurable.

**Architecture graph.** React Flow with an ELK hierarchical layout, then force-directed and
directory-grouped layouts in Phase 9. Nodes are source files. Edges are real relationships with
distinct styles: static import, dynamic import, re-export, type-only import. Interactions: zoom,
pan, drag, select, search, highlight incoming and outgoing, hide unrelated, reset, fit, and filter
by language, directory and relationship type.

**Explorer and inspector.** Directory tree, Shiki source viewer with line numbers, imports and
exports, reverse dependencies, dependency depth, cycle warnings and unresolved imports. Every
dependency is clickable.

**Insights.** Findings from real results: high dependency counts, cycles, unresolved local imports,
large directories, highly connected modules, isolated files. Each has a title, description,
category, severity, affected files, explanation and next action. Language stays cautious: an import
cycle is not a proven runtime error, and there are no arbitrary quality scores.

**Change impact analysis.** Pick a file, or the files changed in a commit or PR. It lists every file
that depends on them, directly or indirectly, and shows that on the graph.

**Knowledge vault.** Everything RepoScope knows about a repo, saved per commit: analysis facts, AI
summaries and notes. MCP reads from this.

**Conventions and notes.** Per-repo rules such as "`shared/` must not import `features/`", plus notes
attached to files or folders.

**MCP.** Read-only tools such as `get_file_context`, `get_dependents`, `get_impact`,
`get_conventions` and `search_files`, scoped to the key owner's repos. The dashboard offers a
copy-paste `claude mcp add` command and an AGENTS.md snippet.

**Risk warnings.** Raised when a change touches a heavily depended-on file, creates a cycle or breaks
a rule. Shown in the UI after sync, and through MCP before an agent edits.

**Private repos (Phase 8).** An official GitHub App with minimal read-only permissions: metadata and
contents, plus pull requests only when PR analysis exists. Installation tokens are short-lived,
generated on the server and never stored. Webhooks verify the signature, start the job and reply
within 10 seconds; deliveries are idempotent. Only changed files are re-analyzed, with a full
re-analysis when a push exceeds the compare API's 300-file limit. Users can disconnect, and revoked
access has clear error states. Private and public repos use the same analysis interface.

## Pages

`/` landing, `/dashboard`, `/repositories/[id]/overview`, `/architecture`, `/explorer`, `/insights`,
plus login and signup.

Analysis states: queued, fetching, scanning, parsing, resolving, generating graph, saving, completed,
failed. A completed state is never shown before the work finishes.

Every failure has a designed state: invalid URL, repo not found, private repo, rate limit, repo too
large, unsupported language, no source files, analysis failed, unresolved imports, empty graph.

## API

`POST /api/repositories/import`, `GET /api/repositories`, `GET` and `DELETE /api/repositories/[id]`,
`POST /api/repositories/[id]/analyze`, `GET /api/analysis/[id]` with `/graph`, `/files`,
`/files/[fileId]` and `/insights`.

## Security

- Never execute imported code. Treat source and READMEs as untrusted data
- Fetch only from validated GitHub URLs (no arbitrary URLs, no SSRF)
- Keep service keys, GitHub tokens and private keys on the server and out of logs
- Enforce Row Level Security and ownership checks on every repo endpoint
- Apply rate limits and repository and file size limits
- Extract archives safely (no path traversal)
- Sanitize displayed repository content

## Design

Dark-first developer tool in the spirit of Linear, Vercel, GitHub, Raycast and modern IDEs, without
copying them. Background `#0B0D12`, sidebar `#11141B`, cards `#161A23`, elevated `#1C2230`, accents
`#5B9CFF` and `#8B7CFF`, text `#F3F4F6` and `#9CA3AF`. Geist, with monospace for paths. Compact and
restrained: no fake testimonials, no fabricated statistics, no decorative gradients. Responsive on
desktop, tablet and mobile.
