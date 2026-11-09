import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readWebhook, verifySignature } from "./webhook";

const secret = "test-webhook-secret";
const encode = (text: string) => new TextEncoder().encode(text);
const sign = (body: string, key = secret) =>
  `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

describe("verifySignature", () => {
  const body = '{"zen":"Keep it logically awesome."}';

  it("accepts GitHub's signature of the exact bytes", () => {
    expect(verifySignature(secret, encode(body), sign(body))).toBe(true);
  });

  it.each([
    ["another secret", sign(body, "other")],
    ["a changed body", sign(`${body} `)],
    ["no header", null],
    ["the old sha1 header", `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`],
    ["a short signature", "sha256=abcd"],
    ["junk", "sha256=not-hex-at-all"],
  ])("refuses %s", (_label, header) => {
    expect(verifySignature(secret, encode(body), header)).toBe(false);
  });

  it("refuses everything when no secret is set", () => {
    expect(verifySignature("", encode(body), sign(body, ""))).toBe(false);
  });
});

const repository = {
  id: 7,
  name: "secret",
  full_name: "me/secret",
  owner: { login: "me" },
  html_url: "https://github.com/me/secret",
  description: null,
  default_branch: "main",
  language: "TypeScript",
  private: true,
};

const facts = {
  githubId: 7,
  owner: "me",
  name: "secret",
  fullName: "me/secret",
  githubUrl: "https://github.com/me/secret",
  description: null,
  defaultBranch: "main",
  primaryLanguage: "TypeScript",
};

const sha = "d".repeat(40);
const installation = { id: 42 };

describe("readWebhook", () => {
  it("answers a ping without doing anything", () => {
    expect(readWebhook("ping", { zen: "hi" })).toEqual({ type: "ignore", reason: "ping" });
  });

  it("reads an uninstall, a suspension and its end", () => {
    expect(readWebhook("installation", { action: "deleted", installation })).toEqual({
      type: "uninstalled",
      githubInstallationId: 42,
    });
    expect(readWebhook("installation", { action: "suspend", installation })).toEqual({
      type: "suspended",
      githubInstallationId: 42,
      suspended: true,
    });
    expect(readWebhook("installation", { action: "unsuspend", installation })).toMatchObject({
      suspended: false,
    });
  });

  it("doesn't link a new installation: only the user's own sign-in does that", () => {
    expect(readWebhook("installation", { action: "created", installation })).toMatchObject({
      type: "ignore",
    });
  });

  it("forgets removed repositories", () => {
    expect(
      readWebhook("installation_repositories", {
        action: "removed",
        installation,
        repositories_removed: [{ id: 7 }, { id: 8 }],
      }),
    ).toEqual({ type: "repositories_removed", githubInstallationId: 42, githubIds: [7, 8] });
  });

  it("leaves added repositories until the user connects again", () => {
    expect(
      readWebhook("installation_repositories", {
        action: "added",
        installation,
        repositories_added: [{ id: 9 }],
        repositories_removed: [],
      }),
    ).toMatchObject({ type: "ignore" });
  });

  it.each([
    ["deleted", { type: "repository_deleted", githubId: 7 }],
    ["privatized", { type: "repository_privatized", githubId: 7 }],
    ["publicized", { type: "repository_publicized", githubId: 7, facts }],
    ["renamed", { type: "repository_changed", githubId: 7, facts }],
    ["transferred", { type: "repository_changed", githubId: 7, facts }],
  ])("reads a repository being %s", (action, expected) => {
    expect(readWebhook("repository", { action, repository })).toEqual(expected);
  });

  it("analyzes a push to the default branch", () => {
    expect(
      readWebhook("push", { ref: "refs/heads/main", after: sha, repository, installation }),
    ).toEqual({ type: "push", githubInstallationId: 42, githubId: 7, commitSha: sha, facts });
  });

  it.each([
    ["another branch", { ref: "refs/heads/feature", after: sha }],
    ["a tag", { ref: "refs/tags/main", after: sha }],
    ["a deleted branch", { ref: "refs/heads/main", after: "0".repeat(40), deleted: true }],
    ["a commit that isn't a hash", { ref: "refs/heads/main", after: "main" }],
  ])("ignores a push to %s", (_label, push) => {
    expect(readWebhook("push", { ...push, repository, installation })).toMatchObject({
      type: "ignore",
    });
  });

  it("ignores what it can't read, rather than guessing", () => {
    expect(readWebhook("push", { ref: "refs/heads/main" })).toMatchObject({ type: "ignore" });
    expect(readWebhook("repository", null)).toMatchObject({ type: "ignore" });
    expect(readWebhook("installation", { action: "deleted" })).toMatchObject({ type: "ignore" });
    expect(readWebhook(null, {})).toMatchObject({ type: "ignore" });
    expect(readWebhook("issues", { action: "opened" })).toMatchObject({ type: "ignore" });
  });
});
