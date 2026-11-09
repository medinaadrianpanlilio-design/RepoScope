import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { RepositoryMetadata } from "./client";

/** GitHub signs the exact bytes it sent, so the check runs before the body is parsed. */
export function verifySignature(secret: string, body: Uint8Array, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  html_url: z.string(),
  description: z.string().nullable().optional(),
  default_branch: z.string(),
  language: z.string().nullable().optional(),
  private: z.boolean(),
});

const installationSchema = z.object({ id: z.number().int().positive() });

const installationEvent = z.object({
  action: z.string(),
  installation: installationSchema,
});

const installationRepositoriesEvent = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional(),
});

const repositoryEvent = z.object({
  action: z.string(),
  repository: repositorySchema,
});

const pushEvent = z.object({
  ref: z.string(),
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: repositorySchema,
  installation: installationSchema,
});

export type RepositoryFacts = Omit<RepositoryMetadata, "isPrivate">;

export type WebhookAction =
  | { type: "ignore"; reason: string }
  | { type: "uninstalled"; githubInstallationId: number }
  | { type: "suspended"; githubInstallationId: number; suspended: boolean }
  | { type: "repositories_removed"; githubInstallationId: number; githubIds: number[] }
  | { type: "repository_deleted"; githubId: number }
  | { type: "repository_privatized"; githubId: number }
  | { type: "repository_publicized"; githubId: number; facts: RepositoryFacts }
  | { type: "repository_changed"; githubId: number; facts: RepositoryFacts }
  | {
      type: "push";
      githubInstallationId: number;
      githubId: number;
      commitSha: string;
      facts: RepositoryFacts;
    };

function factsOf(repository: z.infer<typeof repositorySchema>): RepositoryFacts {
  return {
    githubId: repository.id,
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    githubUrl: repository.html_url,
    description: repository.description ?? null,
    defaultBranch: repository.default_branch,
    primaryLanguage: repository.language ?? null,
  };
}

const ignore = (reason: string): WebhookAction => ({ type: "ignore", reason });

/**
 * Decides what one delivery means. Every action is safe to apply twice, because GitHub can send
 * the same delivery again. Repositories added to an installation are ignored on purpose: the user
 * hasn't been checked against them, so they wait until the user connects again (ADR 0009).
 */
export function readWebhook(event: string | null, payload: unknown): WebhookAction {
  switch (event) {
    case "ping":
      return ignore("ping");

    case "installation": {
      const parsed = installationEvent.safeParse(payload);
      if (!parsed.success) return ignore("unreadable installation event");
      const { action, installation } = parsed.data;
      if (action === "deleted") return { type: "uninstalled", githubInstallationId: installation.id };
      if (action === "suspend" || action === "unsuspend") {
        return { type: "suspended", githubInstallationId: installation.id, suspended: action === "suspend" };
      }
      return ignore(`installation ${action}`);
    }

    case "installation_repositories": {
      const parsed = installationRepositoriesEvent.safeParse(payload);
      if (!parsed.success) return ignore("unreadable installation_repositories event");
      const removed = parsed.data.repositories_removed ?? [];
      if (parsed.data.action !== "removed" || removed.length === 0) {
        return ignore("repositories added wait for the user to connect again");
      }
      return {
        type: "repositories_removed",
        githubInstallationId: parsed.data.installation.id,
        githubIds: removed.map((repository) => repository.id),
      };
    }

    case "repository": {
      const parsed = repositoryEvent.safeParse(payload);
      if (!parsed.success) return ignore("unreadable repository event");
      const { action, repository } = parsed.data;
      switch (action) {
        case "deleted":
          return { type: "repository_deleted", githubId: repository.id };
        case "privatized":
          return { type: "repository_privatized", githubId: repository.id };
        case "publicized":
          return { type: "repository_publicized", githubId: repository.id, facts: factsOf(repository) };
        case "renamed":
        case "transferred":
        case "edited":
          return { type: "repository_changed", githubId: repository.id, facts: factsOf(repository) };
        default:
          return ignore(`repository ${action}`);
      }
    }

    case "push": {
      const parsed = pushEvent.safeParse(payload);
      if (!parsed.success) return ignore("unreadable push event");
      const { ref, after, deleted, repository, installation } = parsed.data;
      if (deleted || !/^[0-9a-f]{40}$/.test(after) || /^0+$/.test(after)) return ignore("branch deleted");
      if (ref !== `refs/heads/${repository.default_branch}`) return ignore("not the default branch");
      return {
        type: "push",
        githubInstallationId: installation.id,
        githubId: repository.id,
        commitSha: after,
        facts: factsOf(repository),
      };
    }

    default:
      return ignore(`event ${event ?? "missing"}`);
  }
}
