import { describe, expect, it, vi } from "vitest";
import { checkLocalAi, createSseParser, isLoopbackEndpoint, setupCommand, streamChat } from "./local";

const endpoint = "http://localhost:9931";

describe("isLoopbackEndpoint", () => {
  it.each(["http://localhost:9931", "http://127.0.0.1:11434", "http://[::1]:9931"])(
    "accepts %s",
    (url) => {
      expect(isLoopbackEndpoint(url)).toBe(true);
    },
  );

  it.each([
    "https://evil.example",
    "http://192.168.1.5:9931",
    "http://localhost.evil.example:9931",
    "http://user@localhost:9931",
    "ftp://localhost",
    "not a url",
  ])("refuses %s, so code can't be sent off this PC", (url) => {
    expect(isLoopbackEndpoint(url)).toBe(false);
  });
});

describe("checkLocalAi", () => {
  const respond = (status: number, body: unknown) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

  it("reports the loaded model, without its folder", async () => {
    const fetchImpl = respond(200, { data: [{ id: "E:\\tools\\models\\qwen.gguf" }] });

    expect(await checkLocalAi(endpoint, fetchImpl)).toEqual({ status: "connected", model: "qwen.gguf" });
  });

  it("marks the request as going to this machine", async () => {
    const fetchImpl = respond(200, { data: [{ id: "m" }] });
    await checkLocalAi(endpoint, fetchImpl);

    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost:9931/v1/models");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ targetAddressSpace: "loopback" });
  });

  it("notices a model that's still loading", async () => {
    expect(await checkLocalAi(endpoint, respond(503, {}))).toEqual({ status: "loading" });
  });

  it("reports an unreachable server", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await checkLocalAi(endpoint, fetchImpl)).toEqual({ status: "unreachable" });
  });

  it("never contacts anything off this machine", async () => {
    const fetchImpl = respond(200, { data: [{ id: "m" }] });

    expect(await checkLocalAi("https://evil.example", fetchImpl)).toEqual({ status: "unreachable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createSseParser", () => {
  const chunk = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it("reads streamed text", () => {
    const out: string[] = [];
    const feed = createSseParser((text) => out.push(text));
    feed(chunk("Hello") + chunk(" there") + "data: [DONE]\n\n");

    expect(out.join("")).toBe("Hello there");
  });

  it("joins an event split across network chunks", () => {
    const out: string[] = [];
    const feed = createSseParser((text) => out.push(text));
    const event = chunk("Hello");
    feed(event.slice(0, 12));
    feed(event.slice(12));

    expect(out).toEqual(["Hello"]);
  });

  it("ignores thinking text and malformed lines", () => {
    const out: string[] = [];
    const feed = createSseParser((text) => out.push(text));
    feed(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] })}\n\n`);
    feed("data: {not json}\n\n: keep-alive\n\n");

    expect(out).toEqual([]);
  });
});

describe("streamChat", () => {
  const stream = (...events: string[]) =>
    new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
  const event = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it("returns the full answer and reports progress", async () => {
    const onText = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => stream(event("Hi"), event("!"), "data: [DONE]\n\n"));

    const answer = await streamChat({
      endpoint,
      model: "m",
      messages: [{ role: "user", content: "x" }],
      maxTokens: 50,
      onText,
      fetchImpl,
    });

    expect(answer).toBe("Hi!");
    expect(onText).toHaveBeenLastCalledWith("Hi!");
  });

  it("asks for a direct answer, without thinking", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => stream("data: [DONE]\n\n"));
    await streamChat({ endpoint, model: "m", messages: [], maxTokens: 9, onText: vi.fn(), fetchImpl });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      stream: true,
      max_tokens: 9,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("refuses an endpoint off this machine", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      streamChat({
        endpoint: "https://evil.example",
        model: "m",
        messages: [],
        maxTokens: 9,
        onText: vi.fn(),
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a failed request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 500 }));

    await expect(
      streamChat({ endpoint, model: "m", messages: [], maxTokens: 9, onText: vi.fn(), fetchImpl }),
    ).rejects.toThrow(/couldn't answer/i);
  });
});

describe("setupCommand", () => {
  it("only allows this site to use the model", () => {
    const command = setupCommand("https://repo-scope-delta.vercel.app");

    expect(command).toContain("--cors-origins https://repo-scope-delta.vercel.app");
    expect(command).toContain("--port 9931");
    expect(command).toContain("--reasoning off");
  });
});
