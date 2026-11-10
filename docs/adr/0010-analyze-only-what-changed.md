# Analyze only what changed

A push used to download the whole archive and parse every file again. Now each analysis keeps a
snapshot, and the next one fetches and parses only files whose content changed. Results must be
exactly what a full analysis of the same commit gives, so the snapshot holds parse results only and
everything after parsing runs over the whole repository again.

- **The commit's file list, not the compare API.** The ticket planned GitHub's compare API. It lists at
  most 300 changed files, describes a force push as changes from a merge base rather than from the
  last analysis, and doesn't say whether a path is a file, a link or a submodule. A commit's tree
  lists every file with its mode, size and content hash in one request. Diffing it against the
  snapshot's hashes works after any history rewrite and matches what the archive holds, which has
  regular files only.
- **Parsing is reused; resolving never is.** Parsing reads one file alone, so its result is keyed by
  path and content hash. Resolving, counting connections and finding cycles depend on every file and
  on package.json and tsconfig, so they run over the whole set each time. A new file can make another
  file's unresolved import resolve, and that shows up.
- **The engine makes every decision.** `placePath` and `readContent` are the steps `buildFileSet`
  uses, so skipping, limits and config reading can't drift between the two paths. Inputs are sorted
  before analysis, so arrival order changes nothing.
- **Any doubt reads the archive.** The full path runs instead when there's no usable snapshot, the
  tree comes back truncated, more than 300 files would be fetched, a fetched file doesn't hash to
  what the tree says, a `.gitattributes` uses `export-ignore` or `export-subst` (GitHub's archive
  then differs from the commit), a limit is reached, or anything throws. Limits are left to the full
  path so failures read the same.
- **No source code is kept.** A snapshot holds paths, content hashes, sizes, line counts, imports,
  exports and the short unanalyzable-import excerpts already stored with results. Config files are
  fetched again every time instead of kept. There's one snapshot per repository, readable only by the
  server, and it's deleted with the repository.

Checked against real repositories (this one, ky, zustand, zod and ms) by comparing an incremental
result with a full analysis of the same commit. All matched exactly.
