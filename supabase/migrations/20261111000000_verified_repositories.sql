-- Phase 8, ticket 06: an installation reaches only what its user was checked against.
--
-- Connecting checks the user can see every repository an installation reaches (ADR 0009). An
-- organization owner can add repositories afterwards, and a webhook can't recheck the user. So
-- RepoScope keeps the repositories that passed the check, and opens nothing else until the user
-- connects again. Empty means nothing has been checked yet.

alter table public.github_installations
  add column verified_repository_ids bigint[] not null default '{}';
