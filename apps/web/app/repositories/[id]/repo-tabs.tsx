import Link from "next/link";

type Props = {
  repositoryId: string;
  active: "overview" | "architecture" | "explorer" | "insights" | "conventions";
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "architecture", label: "Architecture" },
  { key: "explorer", label: "Explorer" },
  { key: "insights", label: "Insights" },
  { key: "conventions", label: "Conventions" },
] as const;

export function RepoTabs({ repositoryId, active }: Props) {
  return (
    <nav aria-label="Repository" className="flex gap-1 overflow-x-auto border-b border-line text-sm">
      {TABS.map(({ key, label }) => (
        <Link
          key={key}
          href={`/repositories/${repositoryId}/${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 font-medium transition-colors duration-150 ${
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
