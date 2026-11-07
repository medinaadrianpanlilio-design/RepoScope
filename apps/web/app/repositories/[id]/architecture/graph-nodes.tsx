import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ChevronRight, Folder } from "lucide-react";
import type { GraphFile } from "@/lib/graph/types";

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 38;

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#5b9cff",
  TSX: "#8b7cff",
  JavaScript: "#e3c55a",
  JSX: "#e09a5a",
};

export type FileNodeData = { name: string; path: string; file: GraphFile };
export type FolderNodeData = { name: string; path: string; fileCount: number };

const handles = (
  <>
    <Handle type="target" position={Position.Left} className="graph-handle" isConnectable={false} />
    <Handle type="source" position={Position.Right} className="graph-handle" isConnectable={false} />
  </>
);

export function FileNode({ data }: NodeProps<Node<FileNodeData>>) {
  const { name, path, file } = data;

  return (
    <div className="graph-node" title={path}>
      {handles}
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: LANGUAGE_COLORS[file.language] ?? "#9ca3af" }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      <span
        className="shrink-0 text-[10px] text-muted"
        title={`Used by ${file.incoming} files, uses ${file.outgoing} files`}
      >
        {file.incoming}↓ {file.outgoing}↑
      </span>
    </div>
  );
}

export function FolderNode({ data }: NodeProps<Node<FolderNodeData>>) {
  const { name, path, fileCount } = data;

  return (
    <div className="graph-node graph-node-folder" title={`${path} — click to open`}>
      {handles}
      <Folder size={14} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      <span className="shrink-0 text-[10px] text-muted">
        {fileCount} {fileCount === 1 ? "file" : "files"}
      </span>
      <ChevronRight size={12} className="shrink-0 text-muted" aria-hidden />
    </div>
  );
}

export const nodeTypes = { file: FileNode, folder: FolderNode };
