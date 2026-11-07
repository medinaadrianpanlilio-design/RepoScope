"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { connectLocalAi, disconnectLocalAi, useLocalAi } from "@/lib/ai/connection";
import { setupCommand, streamChat, type ChatMessage } from "@/lib/ai/local";
import {
  chatMessages,
  MAX_CODE_CHARS,
  summaryMessages,
  trimCode,
  type FileFacts,
} from "@/lib/ai/prompts";
import { fileConnections, reach } from "@/lib/graph/details";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";
import { useFileSource } from "./file-views";

const OLLAMA_ENDPOINT = "http://localhost:11434";
const SUMMARY_TOKENS = 220;
const ANSWER_TOKENS = 300;

type Props = { analysisId: string; data: GraphPayload; file: GraphFile };

/** Mount with a key per file, so summaries and chats don't carry over between files. */
export function LocalAiSection(props: Props) {
  const ai = useLocalAi();

  return (
    <section aria-label="Local AI" className="border-b border-line p-3 text-xs">
      <h3 className="flex items-center gap-1.5 font-medium">
        <Sparkles size={14} className="text-accent-2" aria-hidden />
        Local AI
      </h3>

      {ai.phase === "idle" && (
        <>
          <p className="mt-1 text-muted">
            Explain this file with a model on your own computer. Your code goes straight from this
            browser to it, never through RepoScope.
          </p>
          <button type="button" onClick={() => connectLocalAi()} className="button-secondary mt-2">
            Connect local AI
          </button>
        </>
      )}

      {ai.phase === "checking" && (
        <p role="status" className="mt-1 text-muted">
          Looking for a model on this computer. Your browser may ask for permission first.
        </p>
      )}

      {ai.phase === "failed" && <Setup reason={ai.reason} endpoint={ai.endpoint} />}

      {ai.phase === "connected" && (
        <Connected {...props} endpoint={ai.endpoint} model={ai.model} />
      )}
    </section>
  );
}

function Setup({ reason, endpoint }: { reason: "unreachable" | "loading"; endpoint: string }) {
  const origin = window.location.origin;
  const isSafari = /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);

  if (reason === "loading") {
    return (
      <div role="status" className="mt-1">
        <p className="text-muted">Your model is still loading. This can take a minute.</p>
        <button type="button" onClick={() => connectLocalAi()} className="button-secondary mt-2">
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-2">
      <p className="text-danger" role="alert">
        We couldn&apos;t reach a model at {endpoint}.
      </p>
      {isSafari && (
        <p className="text-muted">
          Safari blocks secure sites from reaching this computer. Use Chrome, Edge or Firefox.
        </p>
      )}
      <ol className="list-decimal space-y-2 pl-4 text-muted">
        <li>
          Get{" "}
          <a
            href="https://github.com/ggml-org/llama.cpp/releases"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            llama.cpp
          </a>{" "}
          and a small model such as{" "}
          <a
            href="https://huggingface.co/unsloth/Qwen3.5-4B-GGUF"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            Qwen3.5-4B
          </a>
          .
        </li>
        <li>
          Run this command. It only lets this site use your model:
          <CopyBox text={setupCommand(origin)} />
        </li>
        <li>Try again, and allow local network access if your browser asks.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => connectLocalAi()} className="button-secondary">
          Try again
        </button>
        {endpoint === OLLAMA_ENDPOINT ? (
          <button type="button" onClick={disconnectLocalAi} className="text-accent hover:underline">
            Use llama.cpp instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => connectLocalAi(OLLAMA_ENDPOINT)}
            className="text-accent hover:underline"
          >
            Use Ollama instead
          </button>
        )}
      </div>
      {endpoint === OLLAMA_ENDPOINT && (
        <div className="text-muted">
          For Ollama, start it with this site allowed:
          <CopyBox text={`$env:OLLAMA_ORIGINS="${origin}"; ollama serve`} />
        </div>
      )}
    </div>
  );
}

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The text is on screen and can be selected by hand.
    }
  }

  return (
    <div className="mt-1 flex items-start gap-2 rounded border border-line bg-background p-2">
      <code className="min-w-0 flex-1 font-mono text-[11px] break-all text-foreground">{text}</code>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy command"} className="shrink-0">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

function Connected({ analysisId, data, file, endpoint, model }: Props & { endpoint: string; model: string }) {
  const { source, error } = useFileSource(analysisId, file.id);

  const facts = useMemo<FileFacts | null>(() => {
    if (!source) return null;
    const connections = fileConnections(data, file.id);
    return {
      file,
      code: source.content,
      exports: source.exports,
      imports: connections.imports.map((c) => c.file.path),
      importedBy: connections.importedBy.map((c) => c.file.path),
      usedByCount: reach(data, file.id, "importedBy").count,
    };
  }, [source, data, file]);

  return (
    <>
      <p className="mt-1 flex flex-wrap items-center justify-between gap-2 text-muted">
        <span className="min-w-0 truncate font-mono" title={model}>
          {model}
        </span>
        <button type="button" onClick={disconnectLocalAi} className="text-accent hover:underline">
          Disconnect
        </button>
      </p>

      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      {!facts && !error && (
        <p role="status" className="mt-2 text-muted">
          Reading the file…
        </p>
      )}
      {facts && (
        <>
          {trimCode(facts.code).trimmed && (
            <p className="mt-2 text-muted">
              This file is long, so only its first {MAX_CODE_CHARS.toLocaleString("en-US")} characters
              are read.
            </p>
          )}
          <Summary analysisId={analysisId} file={file} facts={facts} endpoint={endpoint} model={model} />
          <Chat facts={facts} endpoint={endpoint} model={model} />
        </>
      )}
    </>
  );
}

type Saved = { summary: string; corrected_summary: string | null; model: string };

function Summary({
  analysisId,
  file,
  facts,
  endpoint,
  model,
}: {
  analysisId: string;
  file: GraphFile;
  facts: FileFacts;
  endpoint: string;
  model: string;
}) {
  const url = `/api/analysis/${analysisId}/files/${file.id}/summary`;
  const [text, setText] = useState("");
  const [corrected, setCorrected] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState(model);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data: Saved | null } | null) => {
        if (!payload?.data) return;
        setText(payload.data.summary);
        setCorrected(payload.data.corrected_summary);
        setUsedModel(payload.data.model);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, [url]);

  async function save(summary: string, correctedSummary: string | null, savedModel: string) {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary, corrected: correctedSummary, model: savedModel }),
    }).catch(() => null);

    setSaveNote(
      response?.ok
        ? null
        : response?.status === 401
          ? "Sign in to keep summaries."
          : "This summary couldn't be saved.",
    );
  }

  async function generate() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError(null);
    setSaveNote(null);
    setCorrected(null);
    setUsedModel(model);
    setText("");

    try {
      const summary = await streamChat({
        endpoint,
        model,
        messages: summaryMessages(facts),
        maxTokens: SUMMARY_TOKENS,
        onText: setText,
        signal: controller.signal,
      });
      if (summary.trim()) await save(summary, null, model);
      else setError("Your local AI returned an empty answer.");
    } catch (failure) {
      if ((failure as Error).name !== "AbortError") {
        setError("Your local AI stopped responding. Check that it's still running.");
      }
    }
    setRunning(false);
  }

  async function saveCorrection() {
    const value = draft.trim();
    setCorrected(value);
    setEditing(false);
    await save(text, value, usedModel);
  }

  const shown = corrected ?? text;

  return (
    <div className="mt-3">
      {shown && (
        <figure className="rounded border border-accent-2/40 bg-background p-2">
          <figcaption className="mb-1 text-[10px] font-medium tracking-wide text-accent-2 uppercase">
            {corrected ? "AI summary, corrected by you" : "AI summary"}
          </figcaption>
          {editing ? (
            <label>
              <span className="sr-only">Correct this summary</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={5}
                maxLength={4000}
                className="field font-sans"
              />
            </label>
          ) : (
            <p className="whitespace-pre-wrap">{shown}</p>
          )}
          {!running && (
            <div className="mt-1 flex gap-3">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={saveCorrection}
                    disabled={!draft.trim()}
                    className="text-accent hover:underline"
                  >
                    Save correction
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="text-muted hover:underline">
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(shown);
                    setEditing(true);
                  }}
                  className="text-accent hover:underline"
                >
                  Correct this
                </button>
              )}
            </div>
          )}
        </figure>
      )}
      {error && (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      )}
      {saveNote && <p className="mt-1 text-muted">{saveNote}</p>}
      <button type="button" onClick={generate} disabled={running} className="button-secondary mt-2">
        {running ? "Writing…" : text ? "Summarize again" : "Summarize this file"}
      </button>
    </div>
  );
}

function Chat({ facts, endpoint, model }: { facts: FileFacts; endpoint: string; model: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || running) return;

    const conversation: ChatMessage[] = [...messages, { role: "user", content }];
    const controller = new AbortController();
    abort.current = controller;
    setQuestion("");
    setError(null);
    setRunning(true);
    setMessages([...conversation, { role: "assistant", content: "" }]);

    try {
      await streamChat({
        endpoint,
        model,
        messages: chatMessages(facts, conversation),
        maxTokens: ANSWER_TOKENS,
        onText: (text) => setMessages([...conversation, { role: "assistant", content: text }]),
        signal: controller.signal,
      });
    } catch (failure) {
      if ((failure as Error).name !== "AbortError") {
        setMessages(conversation);
        setError("Your local AI stopped responding. Check that it's still running.");
      }
    }
    setRunning(false);
  }

  const connected = facts.imports.length + facts.importedBy.length;

  return (
    <div className="mt-3 border-t border-line pt-3">
      {messages.length > 0 && (
        <ul aria-label="Conversation" aria-live="polite" className="mb-2 space-y-2">
          {messages.map((message, index) => (
            <li key={index} className={message.role === "user" ? "text-muted" : ""}>
              <span className="sr-only">{message.role === "user" ? "You: " : "AI: "}</span>
              <p className="whitespace-pre-wrap">
                {message.content || (running ? "Thinking…" : "")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mb-2 text-danger">
          {error}
        </p>
      )}
      <form onSubmit={ask} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Ask about this file</span>
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about this file"
            maxLength={500}
            className="field"
          />
        </label>
        <button type="submit" disabled={running || !question.trim()} className="button-secondary">
          Ask
        </button>
      </form>
      {messages.length > 0 && (
        <p className="mt-1 text-[10px] text-muted">
          Based on {facts.file.path}, the analysis, and the names of {connected} connected{" "}
          {connected === 1 ? "file" : "files"}. AI answers can be wrong.
        </p>
      )}
    </div>
  );
}
