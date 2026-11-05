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
