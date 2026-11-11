"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ImportForm({ example }: { example?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/repositories/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error?.message ?? "Something went wrong. Try again.");
        setPending(false);
        return;
      }
      router.push(`/repositories/${payload.data.repositoryId}/overview?analyze=1`);
    } catch {
      setError("We couldn't reach RepoScope. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">GitHub repository URL</span>
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repository"
            required
            spellCheck={false}
            autoComplete="off"
            className="field font-mono"
          />
        </label>
        <button type="submit" disabled={pending} className="button-primary">
          {pending ? "Checking GitHub…" : "Import repository"}
          {!pending && <ArrowRight size={16} aria-hidden />}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {example && !error && (
        <p className="mt-2 text-sm text-muted">
          Try{" "}
          <button
            type="button"
            onClick={() => setUrl(example)}
            className="font-mono text-accent underline underline-offset-2 hover:decoration-2"
          >
            {example.replace("https://github.com/", "")}
          </button>
        </p>
      )}
    </form>
  );
}
