import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** Above this size, plain text is faster and the colors add little. */
export const MAX_HIGHLIGHT_BYTES = 200 * 1024;

const THEME = "github-dark-default";

const GRAMMARS: Record<string, string> = {
  TypeScript: "typescript",
  TSX: "tsx",
  JavaScript: "javascript",
  JSX: "jsx",
};

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import("@shikijs/themes/github-dark-default")],
    langs: [
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/jsx"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/** Returns HTML with one `.line` element per line. Shiki escapes the code it's given. */
export async function highlightSource(code: string, language: string): Promise<string> {
  const lines = code.replace(/\n$/, "");

  if (code.length > MAX_HIGHLIGHT_BYTES) return plainText(lines);

  const shiki = await getHighlighter();
  return shiki.codeToHtml(lines, { lang: GRAMMARS[language] ?? "text", theme: THEME });
}

function plainText(code: string): string {
  const body = code
    .split("\n")
    .map((line) => `<span class="line">${escapeHtml(line)}</span>`)
    .join("\n");
  return `<pre class="shiki"><code>${body}</code></pre>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
