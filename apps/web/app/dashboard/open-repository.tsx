"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Imports through the same endpoint as a pasted link, which finds private ones via the App. */
export function OpenRepository({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/repositories/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${fullName}` }),
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
    <span className="flex shrink-0 items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={open}
        disabled={pending}
        aria-label={`Open ${fullName}`}
        className="rounded border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open"}
      </button>
    </span>
  );
}
