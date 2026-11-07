"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CopyBox } from "@/components/copy-box";

type Key = {
  id: string;
  kind: "mcp" | "sync";
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

type Created = Key & { key: string };

const CLI = "node path\\to\\RepoScope\\packages\\cli\\src\\index.ts";

const AGENT_NOTE = `## RepoScope

This project is indexed by RepoScope. Call its \`get_overview\` tool instead of exploring folders.
Before editing a file, call \`get_file_context\`. Before a change, call \`get_risks\` with the paths and
any imports you plan to add. These facts come from static analysis.`;

function usedLabel(key: Key): string {
  return key.last_used_at
    ? `Last used ${new Date(key.last_used_at).toLocaleDateString("en-US", { dateStyle: "medium" })}`
    : "Not used yet";
}

export function ConnectPanel() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [kind, setKind] = useState<Key["kind"]>("mcp");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/keys")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => setKeys(payload.data))
      .catch(() => setError("We couldn't load your keys."));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);

    const response = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, name }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null);

    if (response?.ok) {
      setCreated(payload.data);
      setKeys((current) => [payload.data, ...(current ?? [])]);
      setName("");
    } else {
      setError(payload?.error?.message ?? "We couldn't create that key.");
    }
    setBusy(false);
  }

  async function revoke(key: Key) {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working at once.`)) return;

    const response = await fetch(`/api/keys/${key.id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      setKeys((current) => current?.filter((item) => item.id !== key.id) ?? null);
      if (created?.id === key.id) setCreated(null);
    } else {
      setError("We couldn't revoke that key.");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section aria-label="Connect Claude Code" className="mt-10">
      <h2 className="font-medium">Connect Claude Code</h2>
      <p className="mt-1 text-sm text-muted">
        A sync key uploads analysis results from your PC. An MCP key lets a coding agent read them. Your
        source code stays on your computer.
      </p>

      <form onSubmit={create} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label>
          <span className="sr-only">Key type</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as Key["kind"])}
            className="field sm:w-40"
          >
            <option value="mcp">MCP key</option>
            <option value="sync">Sync key</option>
          </select>
        </label>
        <label className="flex-1">
          <span className="sr-only">Key name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name, such as My PC"
            required
            maxLength={60}
            className="field"
          />
        </label>
        <button type="submit" disabled={busy} className="button-primary">
          {busy ? "Creating…" : "Create key"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {created && (
        <div role="status" className="mt-3 rounded-md border border-accent/50 bg-card p-3 text-xs">
          <p className="font-medium">Copy this now. It won&apos;t be shown again.</p>
          <CopyBox text={created.key} label="Copy key" />
          {created.kind === "mcp" ? (
            <>
              <p className="mt-3 text-muted">Add RepoScope to Claude Code:</p>
              <CopyBox
                text={`claude mcp add --transport http reposcope ${origin}/api/mcp --header "Authorization: Bearer ${created.key}"`}
              />
              <p className="mt-3 text-muted">Then add this to your project&apos;s AGENTS.md:</p>
              <CopyBox text={AGENT_NOTE} label="Copy note" />
            </>
          ) : (
            <>
              <p className="mt-3 text-muted">Save the key, then sync a project from its folder:</p>
              <CopyBox text={`${CLI} login ${created.key}${origin.includes("localhost") ? ` ${origin}` : ""}`} />
              <CopyBox text={`${CLI} sync`} />
              <p className="mt-3 text-muted">To sync whenever Claude Code starts in that project:</p>
              <CopyBox text={`${CLI} install-hook`} />
            </>
          )}
        </div>
      )}

      {keys === null && !error && (
        <p role="status" className="mt-3 text-sm text-muted">
          Loading keys…
        </p>
      )}
      {keys && keys.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-card text-sm">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{key.name}</span>
                <span className="block truncate font-mono text-xs text-muted">
                  {key.kind === "mcp" ? "MCP" : "Sync"} · {key.key_prefix}… · {usedLabel(key)}
                </span>
              </span>
              <button type="button" onClick={() => revoke(key)} className="text-xs text-danger hover:underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
