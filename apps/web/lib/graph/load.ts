import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  GraphData,
  GraphEdge,
  GraphFile,
  RelationshipType,
  UnresolvedImport,
} from "./types";

const PAGE_SIZE = 1000;

type FileRow = {
  id: number;
  file_path: string;
  language: string;
  line_count: number;
  incoming_count: number;
  outgoing_count: number;
};

type EdgeRow = { source_file_id: number; target_file_id: number; relationship_type: string };
type UnresolvedRow = { source_file_id: number; import_specifier: string; line_number: number };

/** Reads as the visitor, so Row Level Security decides what they can see. */
export async function loadGraph(
  analysisId: string,
): Promise<GraphData & { unresolved: UnresolvedImport[] }> {
  const supabase = await createClient();

  async function readAll<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq("analysis_id", analysisId)
        .order("id")
        .range(from, from + PAGE_SIZE - 1)
        .overrideTypes<T[], { merge: false }>();
      if (error) throw new Error(`Could not load ${table}: ${error.code}`);
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  const [fileRows, edgeRows, unresolvedRows] = await Promise.all([
    readAll<FileRow>(
      "repository_files",
      "id, file_path, language, line_count, incoming_count, outgoing_count",
    ),
    readAll<EdgeRow>("dependency_edges", "source_file_id, target_file_id, relationship_type"),
    readAll<UnresolvedRow>(
      "unresolved_imports",
      "source_file_id, import_specifier, line_number",
    ),
  ]);

  return {
    ...toGraphData(fileRows, edgeRows),
    unresolved: unresolvedRows.map((row) => ({
      fileId: row.source_file_id,
      specifier: row.import_specifier,
      line: row.line_number,
    })),
  };
}

export function toGraphData(fileRows: FileRow[], edgeRows: EdgeRow[]): GraphData {
  const files: GraphFile[] = fileRows.map((row) => ({
    id: row.id,
    path: row.file_path,
    language: row.language,
    lines: row.line_count,
    incoming: row.incoming_count,
    outgoing: row.outgoing_count,
  }));

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const row of edgeRows) {
    const key = `${row.source_file_id}>${row.target_file_id}>${row.relationship_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source: row.source_file_id,
      target: row.target_file_id,
      type: row.relationship_type as RelationshipType,
    });
  }

  return { files, edges };
}
