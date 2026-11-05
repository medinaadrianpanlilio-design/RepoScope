# RepoScope glossary

**Repository:** a codebase RepoScope knows about, from GitHub, a local folder, or both.
_Avoid_: project, repo entry

**Saved repository:** a Repository a signed-in user keeps on their dashboard.

**Analysis run:** one pass of the engine over one commit of a Repository.
_Avoid_: scan, job, index

**Working copy:** an Analysis run over a local folder that includes uncommitted changes.

**Local folder:** a Repository read from disk. Its source never leaves the user's PC.

**Knowledge vault:** everything RepoScope knows about a Repository: analysis facts, AI summaries,
notes and conventions.
_Avoid_: database, cache, memory

**Dependency edge:** a relationship found in source code between two files. It is one of: static
import, dynamic import, re-export, type-only import.
_Avoid_: link, connection

**Unresolved import:** an import the engine could not match to a file. It is reported, never guessed.

**Insight:** a cautious observation drawn from analysis results. It is not proof of a bug.
_Avoid_: issue, error, score

**Change impact:** every file that depends, directly or indirectly, on a set of changed files.
_Avoid_: blast radius

**Convention:** a rule a user writes for a Repository. An import rule is checked against the graph;
a note is free text passed to agents.

**Risk warning:** an alert that a change touches a heavily depended-on file, creates a cycle or
breaks a Convention.

**Local AI:** a model the viewer runs on their own PC, reached from their browser.
_Avoid_: backend AI, cloud AI

**MCP key:** a read-only key a coding agent uses to read the Knowledge vault.

**Sync key:** a key that can only upload analysis results for its owner's Repositories.
