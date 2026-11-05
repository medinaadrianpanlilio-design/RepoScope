# No npm workspaces

The repo lives on an exFAT drive, which has no symlink support, so `npm install` with workspaces
fails with `EISDIR` on the workspace link. Each package installs on its own, and `apps/web` imports
`packages/engine` by path through a TypeScript alias.

Moving the repo to an NTFS drive would allow workspaces, but the user keeps all projects on this
drive. Revisit if a package manager or tool starts to need links.
