# Conventions are stored, broken rules and risks are computed

A Convention is stored, private to one user even on a public Repository. Whether a rule is broken, and
any Risk warning, is worked out on demand from the saved analysis and never stored. Editing a rule
applies to the latest analysis straight away, with nothing to re-run and nothing to keep in step.

- **Two rule types.** `must_not`: files matching one pattern must not import another. `only`: they may
  import only that pattern, plus each other. An import that stays inside one side isn't crossing
  anything, so it never counts. Type-only imports do count, and are labeled.
- **Patterns are checked before they're stored,** and have at most four wildcards, so a pattern can't
  make the regular expression behind it slow.
- **Change detection uses what's stored.** Source isn't kept, so a file counts as changed when its size,
  line count or imports differ. An edit that keeps all three the same isn't noticed.
- **Heavily used is relative.** A file qualifies when its importers are far above the repository's own
  normal range, or at least a fifth of the repository depends on it. A floor stops small numbers
  counting.
- **Warnings stay cautious.** Each one names its evidence, and an empty result says it isn't proof of
  safety.
- **Found files are untrusted.** `AGENTS.md`, `CLAUDE.md` and `CONTRIBUTING.md` are fetched on demand and
  never stored. The site shows them as plain text, and MCP labels them as repository content, not
  instructions. A local folder's copy stays on the PC, so only its name is reported.
- **A synced clone wins a name clash.** A clone and its public record share a name, so MCP picks the
  clone, which is the code being worked on. Two different repositories with the same short name are
  never guessed between.

MCP reads Conventions with the server client, which bypasses Row Level Security, so `conventionsOf` must
always filter by user.

## What MCP saves

Measured on this repository in November 2026, at 154 files, estimating four characters per token. One
repository, so treat these as a guide.

| Question | With MCP | By hand |
|---|---|---|
| What is this repository? | `get_overview`: 456 | File list, README and package files: 2,588 |
| Which files matter most? | Same call | Every local import line: 7,784 |
| What reaches `details.ts`? | `get_impact`: 322, all 19 files | Reading its 6 direct importers: 14,447, one level only |
| What imports `details.ts` directly? | `get_file_context`: 129 | One search: 169 |

The last row is the honest limit: for direct importers, a search costs about the same. The savings
come from questions that need several steps. The eight tool definitions also cost about 990 tokens
whenever they're loaded, so one `get_overview` pays that back, but a very small task may gain nothing.
