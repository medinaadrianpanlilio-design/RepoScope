import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const applyWebhook = vi.hoisted(() => vi.fn(async () => ({ action: "push", detail: "analysis started" })));
vi.mock("@/lib/github/webhook-actions", () => ({ applyWebhook }));

const { POST } = await import("./route");

const secret = "route-test-secret";
const sign = (body: string, key = secret) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

const uninstall = JSON.stringify({ action: "deleted", installation: { id: 99, account: { login: "me" } } });

function deliver(body: string, signature: string | null, event = "installation") {
  const headers = new Headers({ "content-type": "application/json", "x-github-event": event });
  if (signature) headers.set("x-hub-signature-256", signature);
  return POST(new Request("http://localhost/api/github/webhook", { method: "POST", headers, body }));
}

describe("POST /api/github/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", secret);
    applyWebhook.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("applies a delivery GitHub signed", async () => {
    const response = await deliver(uninstall, sign(uninstall));
    expect(response.status).toBe(202);
    expect(applyWebhook).toHaveBeenCalledOnce();
  });

  it.each([
    ["no signature", null],
    ["a signature made with another secret", sign(uninstall, "guessed")],
    ["a signature of a different body", sign(uninstall.replace("99", "98"))],
    ["a signature with no key at all", sign(uninstall, "")],
  ])("refuses a forged delivery with %s, before reading it", async (_label, signature) => {
    const response = await deliver(uninstall, signature);
    expect(response.status).toBe(401);
    expect(applyWebhook).not.toHaveBeenCalled();
  });

  it("refuses a body changed after signing, even by one byte", async () => {
    const signature = sign(uninstall);
    const response = await deliver(`${uninstall} `, signature);
    expect(response.status).toBe(401);
    expect(applyWebhook).not.toHaveBeenCalled();
  });

  it("accepts nothing while no secret is set", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const response = await deliver(uninstall, sign(uninstall, ""));
    expect(response.status).toBe(503);
    expect(applyWebhook).not.toHaveBeenCalled();
  });
});
