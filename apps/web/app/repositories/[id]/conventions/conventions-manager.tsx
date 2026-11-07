"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { NoteConvention, RuleConvention } from "@/lib/conventions/schema";

type Violation = { source: string; target: string; type?: string };
type Rule = RuleConvention & { violationCount?: number; violations?: Violation[] };
type Item = Rule | NoteConvention;

type Listing = { analyzed: boolean; conventions: Item[] };

const EMPTY_RULE = { from: "", to: "", mode: "must_not" as Rule["mode"] };
const EMPTY_NOTE = { body: "", path: "" };

export function ConventionsManager({ repositoryId }: { repositoryId: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState(EMPTY_RULE);
  const [note, setNote] = useState(EMPTY_NOTE);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/repositories/${repositoryId}/conventions`;

  async function reload() {
    const response = await fetch(base).catch(() => null);
    const payload = await response?.json().catch(() => null);
    if (response?.ok) setListing(payload.data);
    else setError("We couldn't load your Conventions.");
  }

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (!cancelled) setListing(payload.data);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your Conventions.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  function reset() {
    setRule(EMPTY_RULE);
    setNote(EMPTY_NOTE);
    setEditing(null);
  }

  async function save(event: FormEvent, body: Record<string, unknown>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(editing ? `${base}/${editing}` : base, {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null);

    if (response?.ok) {
      reset();
      await reload();
    } else {
      setError(payload?.error?.message ?? "We couldn't save that.");
    }
    setBusy(false);
  }

  async function remove(item: Item) {
    if (!window.confirm("Delete this? It can't be undone.")) return;

    const response = await fetch(`${base}/${item.id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      if (editing === item.id) reset();
      await reload();
    } else {
      setError("We couldn't delete that.");
    }
  }

  function edit(item: Item) {
    setError(null);
    setEditing(item.id);
    if (item.kind === "import_rule") {
      setRule({ from: item.from, to: item.to, mode: item.mode });
      setNote(EMPTY_NOTE);
    } else {
      setNote({ body: item.body, path: item.path ?? "" });
      setRule(EMPTY_RULE);
    }
  }

  const items = listing?.conventions ?? [];
  const rules = items.filter((item): item is Rule => item.kind === "import_rule");
  const notes = items.filter((item): item is NoteConvention => item.kind === "note");
  const editingRule = rules.some((item) => item.id === editing);
  const editingNote = notes.some((item) => item.id === editing);

  return (
    <div className="mt-6 space-y-10">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <section aria-label="Import rules">
        <h2 className="font-medium">Import rules</h2>
        <p className="mt-1 text-sm text-muted">
          Checked against every analysis. Private to you, and sent to your coding agent.
        </p>

        <form
          onSubmit={(event) => save(event, { kind: "import_rule", ...rule })}
          className="mt-3 flex flex-col gap-2 sm:flex-row"
        >
          <label className="flex-1">
            <span className="sr-only">Files the rule applies to</span>
            <input
              value={rule.from}
              onChange={(event) => setRule({ ...rule, from: event.target.value })}
              placeholder="shared/**"
              required
              maxLength={200}
              className="field font-mono"
            />
          </label>
          <label>
            <span className="sr-only">Rule type</span>
            <select
              value={rule.mode}
              onChange={(event) => setRule({ ...rule, mode: event.target.value as Rule["mode"] })}
              className="field sm:w-44"
            >
              <option value="must_not">must not import</option>
              <option value="only">may only import</option>
            </select>
          </label>
          <label className="flex-1">
            <span className="sr-only">Files they import</span>
            <input
              value={rule.to}
              onChange={(event) => setRule({ ...rule, to: event.target.value })}
              placeholder="features/**"
              required
              maxLength={200}
              className="field font-mono"
            />
          </label>
          <button type="submit" disabled={busy} className="button-primary">
            {editingRule ? "Save rule" : "Add rule"}
          </button>
          {editingRule && (
            <button type="button" onClick={reset} className="button-secondary">
              Cancel
            </button>
          )}
        </form>

        {!listing && !error && (
          <p role="status" className="mt-3 text-sm text-muted">
            Loading your rules…
          </p>
        )}
        {listing && rules.length === 0 && (
          <p className="mt-3 text-sm text-muted">No rules yet.</p>
        )}
        {rules.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-card text-sm">
            {rules.map((item) => (
              <li key={item.id} className="p-3">
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1 font-mono break-words">{item.text}</span>
                  <ItemActions onEdit={() => edit(item)} onDelete={() => remove(item)} />
                </div>
                <RuleResult rule={item} analyzed={listing?.analyzed ?? false} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Notes">
        <h2 className="font-medium">Notes</h2>
        <p className="mt-1 text-sm text-muted">
          Anything your coding agent should know. Add a path to attach a note to one folder or file.
        </p>

        <form
          onSubmit={(event) =>
            save(event, { kind: "note", body: note.body, path: note.path.trim() || null })
          }
          className="mt-3 space-y-2"
        >
          <label className="block">
            <span className="sr-only">Note</span>
            <textarea
              value={note.body}
              onChange={(event) => setNote({ ...note, body: event.target.value })}
              placeholder="Payments always go through the queue."
              required
              maxLength={2000}
              rows={3}
              className="field"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex-1">
              <span className="sr-only">Folder or file, optional</span>
              <input
                value={note.path}
                onChange={(event) => setNote({ ...note, path: event.target.value })}
                placeholder="Folder or file, or leave empty for the whole repository"
                maxLength={500}
                className="field font-mono"
              />
            </label>
            <button type="submit" disabled={busy} className="button-primary">
              {editingNote ? "Save note" : "Add note"}
            </button>
            {editingNote && (
              <button type="button" onClick={reset} className="button-secondary">
                Cancel
              </button>
            )}
          </div>
        </form>

        {listing && notes.length === 0 && <p className="mt-3 text-sm text-muted">No notes yet.</p>}
        {notes.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-card text-sm">
            {notes.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs break-words text-muted">
                    {item.path ?? "Whole repository"}
                  </span>
                  <span className="mt-0.5 block break-words whitespace-pre-wrap">{item.body}</span>
                </span>
                <ItemActions onEdit={() => edit(item)} onDelete={() => remove(item)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ItemActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex shrink-0 gap-3 text-xs">
      <button type="button" onClick={onEdit} className="text-accent hover:underline">
        Edit
      </button>
      <button type="button" onClick={onDelete} className="text-danger hover:underline">
        Delete
      </button>
    </span>
  );
}

function RuleResult({ rule, analyzed }: { rule: Rule; analyzed: boolean }) {
  if (!analyzed) {
    return <p className="mt-1 text-xs text-muted">This will be checked once the repository is analyzed.</p>;
  }

  const count = rule.violationCount ?? 0;
  if (count === 0) {
    return <p className="mt-1 text-xs text-muted">No imports break this rule.</p>;
  }

  const shown = rule.violations ?? [];
  return (
    <div className="mt-1 text-xs">
      <p className="text-danger">
        {count.toLocaleString("en-US")} {count === 1 ? "import breaks" : "imports break"} this rule
      </p>
      <ul className="mt-1 space-y-0.5 font-mono">
        {shown.map((violation) => (
          <li key={`${violation.source}>${violation.target}>${violation.type}`} className="break-words">
            {violation.source} imports {violation.target}
            {violation.type === "type" && <span className="text-muted"> (types only)</span>}
          </li>
        ))}
        {count > shown.length && <li className="text-muted">and {count - shown.length} more</li>}
      </ul>
    </div>
  );
}
