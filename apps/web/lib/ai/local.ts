export const DEFAULT_ENDPOINT = "http://localhost:9931";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CHECK_TIMEOUT_MS = 4000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LocalAiCheck =
  | { status: "connected"; model: string }
  | { status: "loading" }
  | { status: "unreachable" };

/** Repository code may be private, so it's only ever sent to the viewer's own machine. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Chrome and Firefox need this to let an https page call this machine. */
const LOOPBACK_FETCH = { targetAddressSpace: "loopback" } as RequestInit;

export async function checkLocalAi(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAiCheck> {
  if (!isLoopbackEndpoint(endpoint)) return { status: "unreachable" };

  try {
    const response = await fetchImpl(`${endpoint}/v1/models`, {
      ...LOOPBACK_FETCH,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (response.status === 503) return { status: "loading" };
    if (!response.ok) return { status: "unreachable" };

    const payload = await response.json();
    const id = String(payload.data?.[0]?.id ?? "local model");
    return { status: "connected", model: id.split(/[\\/]/).pop() ?? id };
  } catch {
    return { status: "unreachable" };
  }
}

/** Reads server-sent events, which can split at any byte across network chunks. */
export function createSseParser(onDelta: (text: string) => void) {
  let buffer = "";

  return (chunk: string) => {
    buffer += chunk;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const content = JSON.parse(data).choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) onDelta(content);
        } catch {
          // A line that isn't JSON carries no text.
        }
      }
    }
  };
}

type ChatOptions = {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  onText: (textSoFar: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export async function streamChat({
  endpoint,
  model,
  messages,
  maxTokens,
  onText,
  signal,
  fetchImpl = fetch,
}: ChatOptions): Promise<string> {
  if (!isLoopbackEndpoint(endpoint)) throw new Error("Local AI must run on this computer.");

  const response = await fetchImpl(`${endpoint}/v1/chat/completions`, {
    ...LOOPBACK_FETCH,
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok || !response.body) throw new Error("Your local AI couldn't answer that.");

  let text = "";
  const feed = createSseParser((delta) => {
    text += delta;
    onText(text);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  feed("\n\n");
  return text;
}

/** Locked to one site, because llama-server otherwise lets any website use the model. */
export function setupCommand(origin: string): string {
  return `llama-server -m path\\to\\model.gguf -ngl 99 -c 8192 --port 9931 --reasoning off --cors-origins ${origin}`;
}
