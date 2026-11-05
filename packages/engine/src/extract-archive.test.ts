import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ArchiveError, extractTarGz } from "./extract-archive.ts";

type Entry = { name: string; body?: string; type?: string; prefix?: string };

function header(name: string, size: number, type: string, prefix = ""): Uint8Array {
  const block = new Uint8Array(512);
  const write = (text: string, at: number) => block.set(new TextEncoder().encode(text), at);
  write(name, 0);
  write("0000644\0", 100);
  write(size.toString(8).padStart(11, "0") + "\0", 124);
  write("        ", 148);
  write(type, 156);
  write("ustar\0" + "00", 257);
  write(prefix, 345);
  const sum = block.reduce((total, byte) => total + byte, 0);
  write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return block;
}

function tar(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { name, body = "", type = "0", prefix } of entries) {
    const data = new TextEncoder().encode(body);
    parts.push(header(name, data.length, type, prefix));
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    parts.push(padded);
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function pax(key: string, value: string): string {
  const rest = ` ${key}=${value}
`;
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
  return `${length}${rest}`;
}

const pack = (entries: Entry[]) => gzipSync(tar(entries));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("extractTarGz", () => {
  it("strips the wrapper directory and keeps file contents", () => {
    const result = extractTarGz(
      pack([
        { name: "owner-repo-abc123/", type: "5" },
        { name: "owner-repo-abc123/src/index.ts", body: "export {};" },
        { name: "owner-repo-abc123/package.json", body: "{}" },
      ]),
    );
    expect(result.files.map((f) => f.path).sort()).toEqual(["package.json", "src/index.ts"]);
    expect(text(result.files.find((f) => f.path === "src/index.ts")!.bytes)).toBe("export {};");
  });

  it("reads the commit from GitHub's global pax header", () => {
    const sha = "a".repeat(40);
    const result = extractTarGz(
      pack([
        { name: "pax_global_header", type: "g", body: pax("comment", sha) },
        { name: "root/a.ts", body: "1" },
      ]),
    );
    expect(result.commitSha).toBe(sha);
    expect(result.files).toHaveLength(1);
  });

  it("uses a pax path for long names", () => {
    const long = `root/${"d/".repeat(80)}file.ts`;
    const record = `path=${long}\n`;
    const result = extractTarGz(
      pack([
        { name: "pax", type: "x", body: pax("path", long) },
        { name: "truncated", body: "x" },
      ]),
    );
    expect(result.files[0]!.path).toBe(long.split("/").slice(1).join("/"));
  });

  it("joins a ustar prefix to the name", () => {
    const result = extractTarGz(pack([{ name: "file.ts", prefix: "root/lib", body: "x" }]));
    expect(result.files[0]!.path).toBe("lib/file.ts");
  });

  it("drops paths that could escape the root", () => {
    const result = extractTarGz(
      pack([
        { name: "root/../../etc/passwd", body: "x" },
        { name: "/etc/passwd", body: "x" },
        { name: "root/a\\..\\b.ts", body: "x" },
        { name: "root/ok.ts", body: "x" },
      ]),
    );
    expect(result.files.map((f) => f.path)).toEqual(["ok.ts"]);
    expect(result.unsafeEntries).toBe(3);
  });

  it("counts symlinks and hard links but never follows them", () => {
    const result = extractTarGz(
      pack([
        { name: "root/link", type: "2" },
        { name: "root/hard", type: "1" },
        { name: "root/a.ts", body: "x" },
      ]),
    );
    expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(result.unsupportedEntries).toBe(2);
  });

  it("stops a decompression bomb at the size limit", () => {
    const archive = pack([{ name: "root/big.txt", body: "0".repeat(2_000_000) }]);
    expect(archive.length).toBeLessThan(20_000);
    expect(() => extractTarGz(archive, { maxUncompressedBytes: 100_000 })).toThrowError(
      expect.objectContaining({ code: "archive_too_large" }),
    );
  });

  it("enforces the entry limit", () => {
    const archive = pack([
      { name: "root/a.ts", body: "x" },
      { name: "root/b.ts", body: "x" },
    ]);
    expect(() => extractTarGz(archive, { maxEntries: 1 })).toThrowError(
      expect.objectContaining({ code: "too_many_entries" }),
    );
  });

  it("rejects input that is not a gzip tar", () => {
    expect(() => extractTarGz(new TextEncoder().encode("not an archive"))).toThrow(ArchiveError);
    const corrupt = tar([{ name: "root/a.ts", body: "x" }]);
    corrupt[0] = corrupt[0]! ^ 0xff;
    expect(() => extractTarGz(gzipSync(corrupt))).toThrowError(
      expect.objectContaining({ code: "invalid_archive" }),
    );
  });

  it("rejects an entry whose data runs past the end", () => {
    const whole = tar([{ name: "root/a.ts", body: "x".repeat(2000) }]);
    expect(() => extractTarGz(gzipSync(whole.subarray(0, 1024)))).toThrowError(
      expect.objectContaining({ code: "invalid_archive" }),
    );
  });
});
