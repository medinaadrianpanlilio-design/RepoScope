# Engine accuracy and cost, measured

Measured in November 2026 with `packages/engine/scripts`, comparing every import against
TypeScript's own `resolveModuleName`. Dependencies were not installed, so TypeScript can't see
workspace packages. Each row is one repository.

| Repository | Source files | Compared | Agree | Disagree | Time | Result size |
|---|---:|---:|---:|---:|---:|---:|
| Small app | 94 | 181 | 150 | 0 | 0.1 s | 39 KB |
| vuejs/core | 528 | 1,936 | 1,899 | 0 | 0.6 s | 437 KB |
| shadcn-ui/ui | 4,434 | 15,890 | 10,026 | 0 | 1.6 s | 3.5 MB |
| microsoft/vscode | 15,420 | 158,879 | 157,514 | 0 | 17 s | 39 MB |

The rest of "compared" is explained, not wrong:

- Imports of existing non-source files, such as CSS, are not edges.
- Imports neither resolver could find are reported as Unresolved. In shadcn-ui/ui these point at
  `@/styles/...` paths that aren't in the repository.
- Where a `.js` file sits beside its `.d.ts`, the engine picks the `.js`, because the map describes
  code that runs. TypeScript picks the declaration.

**What this changes.** Analysis time is not the limit: 4,434 files took 1.6 s against a 300 s budget.
Storage is. Results run from 0.4 to 2.5 MB per 1,000 files as JSON, before database overhead, against
a 500 MB free database. The cap stays near 2,000 source files for that reason, and these figures
leave out the archive download, which Phase 2 must measure on Vercel.

**Known limit.** A file over 1 MB is skipped, so imports of it are not edges even though it exists.
The checks found this for a few large modules. It is reported as a skipped file, not as Unresolved.

**Measured on Vercel,** with date-fns (1,785 source files, 5,366 dependencies): the full analysis took
17.7 s, and the graph endpoint returned 465 KB in about 4 s. A repository over the file limit fails
in about 4 s with a message naming the limit.

**Measured in the browser** on the same repository: the grouped graph is ready in 2 to 3 s, opening a
folder of 1,660 files takes about 3.5 s, and panning 250 nodes held 57 frames a second in a headless
browser. Laying out all 1,785 files at once takes about 14 s, off the main thread, so the page shows
that it's arranging the graph. The grouped view means few people will reach that case.

**Profiled step by step (Phase 9),** on date-fns again, from a PC against the live database. Before
tuning, a full analysis took 9.4 s: saving 4.3 s, download 3.4 s, parsing 1.1 s, everything else under
0.2 s each. Saving sent about 16 inserts one after another, and loading the graph read its pages one
after another. Both now run up to four requests at once: saving fell to 1.9 s and loading the graph from
about 0.9 s to 0.4 s, with every row still read back. Parsing is the only real CPU work.

**Against Vercel's limits.** The largest allowed repository takes well under a tenth of the 300 s budget,
so analyses stay in a single function and don't need Vercel Workflows. Vercel bills active CPU, not
time spent waiting on GitHub or the database, so a largest-size analysis costs about 2 to 3 CPU-seconds.
The free plan's 4 CPU-hours (14,400 s) a month then covers roughly 5,000 of them, and most analyses are
far smaller. This is an estimate; the real monthly figure is on Vercel's Usage page.
