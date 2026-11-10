"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { installationId: string; accountLogin: string; label: string };

export function DisconnectButton({ installationId, accountLogin, label }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    const confirmed = window.confirm(
      `Disconnect ${accountLogin}? RepoScope removes its private repositories and their analyses. You can connect it again later.`,
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/github/installations/${installationId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message ?? "We couldn't disconnect that account. Try again.");
        setPending(false);
        return;
      }
      router.push("/dashboard?github=disconnected");
      router.refresh();
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
        onClick={disconnect}
        disabled={pending}
        className="rounded border border-line px-2 py-0.5 text-xs hover:border-danger hover:text-danger disabled:opacity-60"
      >
        {pending ? "Disconnecting…" : label}
      </button>
    </span>
  );
}
