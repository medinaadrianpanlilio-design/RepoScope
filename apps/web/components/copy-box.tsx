"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyBox({ text, label = "Copy command" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The text is on screen and can be selected by hand.
    }
  }

  return (
    <div className="mt-1 flex items-start gap-2 rounded border border-line bg-background p-2">
      <code className="min-w-0 flex-1 font-mono text-[11px] break-all whitespace-pre-wrap text-foreground">
        {text}
      </code>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : label} className="shrink-0">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}
