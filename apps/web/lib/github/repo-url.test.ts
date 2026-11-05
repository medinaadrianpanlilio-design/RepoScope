import { describe, expect, it } from "vitest";
import { parseGitHubRepoUrl } from "./repo-url";

describe("parseGitHubRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/vercel/next.js/", "vercel", "next.js"],
    ["https://github.com/vercel/next.js.git", "vercel", "next.js"],
    ["https://www.github.com/vercel/next.js", "vercel", "next.js"],
    ["  https://github.com/vercel/next.js  ", "vercel", "next.js"],
    ["https://github.com/vercel/next.js/tree/canary/docs", "vercel", "next.js"],
    ["https://github.com/vercel/next.js?tab=readme", "vercel", "next.js"],
    ["https://github.com/vercel/next.js#readme", "vercel", "next.js"],
    ["https://GitHub.com/Vercel/Next.js", "Vercel", "Next.js"],
    ["github.com/vercel/next.js", "vercel", "next.js"],
  ])("accepts %s", (input, owner, repo) => {
    expect(parseGitHubRepoUrl(input)).toEqual({ ok: true, owner, repo });
  });

  it.each([
    ["empty", ""],
    ["not a URL", "not a url"],
    ["owner only", "https://github.com/vercel"],
    ["GitHub root", "https://github.com/"],
    ["another host", "https://gitlab.com/vercel/next.js"],
    ["lookalike suffix", "https://github.com.evil.example/vercel/next.js"],
    ["lookalike prefix", "https://evilgithub.com/vercel/next.js"],
    ["subdomain", "https://gist.github.com/vercel/next.js"],
    ["credentials", "https://user:pass@github.com/vercel/next.js"],
    ["host hidden behind credentials", "https://github.com@evil.example/vercel/next.js"],
    ["custom port", "https://github.com:8443/vercel/next.js"],
    ["plain http", "http://github.com/vercel/next.js"],
    ["file scheme", "file:///etc/passwd"],
    ["ssh scheme", "ssh://git@github.com/vercel/next.js"],
    ["dot-dot repo", "https://github.com/vercel/.."],
    ["encoded traversal", "https://github.com/vercel/%2e%2e"],
    ["encoded slash", "https://github.com/vercel%2Fnext.js/repo"],
    ["bad owner characters", "https://github.com/ver_cel/next.js"],
    ["owner starts with hyphen", "https://github.com/-vercel/next.js"],
    ["owner too long", `https://github.com/${"a".repeat(40)}/repo`],
    ["repo too long", `https://github.com/vercel/${"a".repeat(101)}`],
    ["input too long", `https://github.com/vercel/next.js/${"a".repeat(3000)}`],
  ])("rejects %s", (_label, input) => {
    expect(parseGitHubRepoUrl(input).ok).toBe(false);
  });
});
