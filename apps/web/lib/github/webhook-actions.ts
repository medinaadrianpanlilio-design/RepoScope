import "server-only";
import { startAnalysis } from "@/lib/analysis/start";
import { makeRepositoryPublic } from "@/lib/repositories/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { openRepository } from "./repository-access";
import type { RepositoryFacts, WebhookAction } from "./webhook";

export type WebhookOutcome = { action: WebhookAction["type"]; detail: string };

type Db = ReturnType<typeof createAdminClient>;

function factFields(facts: RepositoryFacts) {
  return {
    owner: facts.owner,
    name: facts.name,
    full_name: facts.fullName,
    github_url: facts.githubUrl,
    description: facts.description,
    default_branch: facts.defaultBranch,
    primary_language: facts.primaryLanguage,
    updated_at: new Date().toISOString(),
  };
}

function check<T extends { error: { code?: string } | null }>(result: T, doing: string): T {
  if (result.error) throw new Error(`Could not ${doing}: ${result.error.code ?? "unknown"}`);
  return result;
}

async function installationRow(db: Db, githubInstallationId: number) {
  const { data } = check(
    await db
      .from("github_installations")
      .select("id, verified_repository_ids")
      .eq("github_installation_id", githubInstallationId)
      .maybeSingle(),
    "load installation",
  );
  return data as { id: string; verified_repository_ids: number[] } | null;
}

/** Applies one action. Each is safe to repeat, since GitHub can deliver the same event twice. */
export async function applyWebhook(action: WebhookAction): Promise<WebhookOutcome> {
  const db = createAdminClient();
  const done = (detail: string): WebhookOutcome => ({ action: action.type, detail });

  switch (action.type) {
    case "ignore":
      return done(action.reason);

    case "uninstalled": {
      // Kept with revoked_at so the dashboard can say what happened. What it reached is removed.
      const installation = await installationRow(db, action.githubInstallationId);
      if (!installation) return done("unknown installation");
      check(
        await db
          .from("github_installations")
          .update({
            revoked_at: new Date().toISOString(),
            verified_repository_ids: [],
            updated_at: new Date().toISOString(),
          })
          .eq("id", installation.id)
          .is("revoked_at", null),
        "mark installation removed",
      );
      check(
        await db.from("repositories").delete().eq("installation_id", installation.id),
        "remove repositories",
      );
      return done("removed");
    }

    case "suspended": {
      check(
        await db
          .from("github_installations")
          .update({
            suspended_at: action.suspended ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("github_installation_id", action.githubInstallationId),
        "update suspension",
      );
      return done(action.suspended ? "suspended" : "unsuspended");
    }

    case "repositories_removed": {
      const installation = await installationRow(db, action.githubInstallationId);
      if (!installation) return done("unknown installation");
      const removed = new Set(action.githubIds);
      check(
        await db
          .from("github_installations")
          .update({
            verified_repository_ids: installation.verified_repository_ids.filter((id) => !removed.has(id)),
            updated_at: new Date().toISOString(),
          })
          .eq("id", installation.id),
        "forget repositories",
      );
      check(
        await db
          .from("repositories")
          .delete()
          .eq("installation_id", installation.id)
          .in("github_id", action.githubIds),
        "remove repositories",
      );
      return done(`${action.githubIds.length} removed`);
    }

    case "repository_deleted": {
      check(await db.from("repositories").delete().eq("github_id", action.githubId), "remove repository");
      return done("removed");
    }

    case "repository_privatized": {
      // Its results were readable by everyone. The owner can open it again as a private one.
      check(
        await db.from("repositories").delete().eq("github_id", action.githubId).is("owner_user_id", null),
        "remove public copy",
      );
      return done("public copy removed");
    }

    case "repository_publicized": {
      await makeRepositoryPublic(action.githubId, factFields(action.facts));
      return done("now public");
    }

    case "repository_changed": {
      check(
        await db.from("repositories").update(factFields(action.facts)).eq("github_id", action.githubId),
        "update repository",
      );
      return done("updated");
    }

    case "push":
      return done(await analyzePush(db, action));
  }
}

async function analyzePush(db: Db, action: Extract<WebhookAction, { type: "push" }>) {
  const { data: row } = check(
    await db
      .from("repositories")
      .select("id, github_id, installation_id, owner_user_id")
      .eq("github_id", action.githubId)
      .maybeSingle(),
    "load repository",
  );
  if (!row) return "not imported";

  // A private row is read only through its own installation, never one named by the payload alone.
  if (row.installation_id) {
    const installation = await installationRow(db, action.githubInstallationId);
    if (installation?.id !== row.installation_id) return "different installation";
  }

  check(await db.from("repositories").update(factFields(action.facts)).eq("id", row.id), "update repository");

  const access = await openRepository(
    { ...row, owner: action.facts.owner, name: action.facts.name },
    row.owner_user_id,
  );
  if (!access.ok) return `not readable: ${access.error}`;

  const { start } = await startAnalysis(row.id, action.commitSha, access.reader);
  return start ? "analysis started" : "already analyzed";
}
