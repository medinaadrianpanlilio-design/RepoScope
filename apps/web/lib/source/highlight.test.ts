import { describe, expect, it } from "vitest";
import { highlightSource, MAX_HIGHLIGHT_BYTES } from "./highlight";

describe("highlightSource", () => {
  it("colors code and gives every line its own element", async () => {
    const html = await highlightSource("const a = 1;\nconst b = 2;\n", "TypeScript");

    expect(html).toContain("color:");
    expect(html.match(/class="line"/g)).toHaveLength(2);
  });

  it.each(["TypeScript", "TSX", "JavaScript", "JSX", "Other"])("handles %s", async (language) => {
    expect(await highlightSource("const a = 1;", language)).toContain("<pre");
  });

  it("treats hostile code as text", async () => {
    const html = await highlightSource(
      `const a = "<script>alert(1)</script>";\n// <img src=x onerror=alert(1)>\n`,
      "TypeScript",
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&#x3C;script");
  });

  it("falls back to escaped plain text for a very large file", async () => {
    const html = await highlightSource(`<b>${"x".repeat(MAX_HIGHLIGHT_BYTES)}\nnext`, "TypeScript");

    expect(html).not.toContain("<b>");
    expect(html.match(/class="line"/g)).toHaveLength(2);
  });
});
