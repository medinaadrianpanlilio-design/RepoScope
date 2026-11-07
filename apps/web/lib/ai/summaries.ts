import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Runs as the signed-in user, so Row Level Security keeps summaries private to them. */
export async function getSummary(analysisId: string, filePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_summaries")
    .select("summary, corrected_summary, model")
    .eq("analysis_id", analysisId)
    .eq("file_path", filePath)
    .maybeSingle();

  if (error) throw new Error(`Could not load summary: ${error.code}`);
  return data;
}

export async function saveSummary(input: {
  userId: string;
  analysisId: string;
  filePath: string;
  summary: string;
  corrected: string | null;
  model: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("ai_summaries").upsert(
    {
      user_id: input.userId,
      analysis_id: input.analysisId,
      file_path: input.filePath,
      summary: input.summary,
      corrected_summary: input.corrected,
      model: input.model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,analysis_id,file_path" },
  );

  if (error) throw new Error(`Could not save summary: ${error.code}`);
}
