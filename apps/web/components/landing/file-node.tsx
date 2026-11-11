/**
 * The node RepoScope draws for every file in the graph, used as the landing page's one shape.
 * It is a real piece of the interface, so it keeps the graph's own type and colours.
 */

export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#5b9cff",
  TSX: "#8b7cff",
  JavaScript: "#e3c55a",
  JSX: "#e09a5a",
};

type Props = {
  name: string;
  language: string;
  incoming?: number;
  outgoing?: number;
  state?: "selected" | "impacted";
  className?: string;
};

export function FileNode({ name, language, incoming, outgoing, state, className = "" }: Props) {
  return (
    <span data-ui className={`file-node ${state ? `is-${state}` : ""} ${className}`}>
      <span className="file-node-dot" style={{ background: LANGUAGE_COLORS[language] ?? "#9ca3af" }} aria-hidden />
      <span className="file-node-name">{name}</span>
      {incoming !== undefined && outgoing !== undefined && (
        <span className="file-node-counts" title={`Used by ${incoming} files, uses ${outgoing} files`}>
          {incoming}↓ {outgoing}↑
        </span>
      )}
    </span>
  );
}
