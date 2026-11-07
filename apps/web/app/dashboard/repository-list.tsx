"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SavedRepository } from "@/lib/repositories/queries";

type Sort = "recent" | "name";

export function RepositoryList({ repositories }: { repositories: SavedRepository[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = repositories.filter((repository) =>
      repository.full_name.toLowerCase().includes(needle),
    );
    return sort === "name"
      ? [...matches].sort((a, b) => a.full_name.localeCompare(b.full_name))
      : matches;
  }, [repositories, query, sort]);

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search repositories</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories"
            className="field"
          />
        </label>
        <label>
          <span className="sr-only">Sort repositories</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="field sm:w-44"
          >
            <option value="recent">Recently added</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No repositories match “{query}”.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-card">
          {visible.map((repository) => (
            <li key={repository.id}>
              <Link
                href={`/repositories/${repository.id}/overview`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-elevated"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{repository.full_name}</span>
                  {repository.description && (
                    <span className="block truncate text-sm text-muted">
                      {repository.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  {repository.primary_language && (
                    <span className="block">{repository.primary_language}</span>
                  )}
                  {repository.source === "local" && <span className="block">Local folder</span>}
                  <span className="block">{repository.analysis_label}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
