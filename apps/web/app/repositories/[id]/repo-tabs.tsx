import Link from "next/link";

type Props = { repositoryId: string; active: "overview" | "architecture" | "explorer" | "insights" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "architecture", label: "Architecture" },
  { key: "explorer", label: "Explorer" },
  { key: "insights", label: "Insights" },
] as const;

export function RepoTabs({ repositoryId, active }: Props) {
  return (
    <nav aria-label="Repository" className="flex gap-4 border-b border-line text-sm">
      {TABS.map(({ key, label }) => (
        <Link
          key={key}
          href={`/repositories/${repositoryId}/${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`-mb-px border-b-2 px-1 py-2 ${
            active === key
              ? "border-accent text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
