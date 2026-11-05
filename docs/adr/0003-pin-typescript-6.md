# Pin TypeScript 6

`typescript@latest` is version 7, the native compiler, whose main export has no `createProgram` or
TypeChecker. Its replacement API was still in beta in November 2026. The engine needs the classic
Compiler API, so `typescript` stays on `^6`. Revisit when version 7's API is stable.
