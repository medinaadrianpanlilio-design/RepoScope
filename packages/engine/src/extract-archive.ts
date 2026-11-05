import { gunzipSync } from "node:zlib";
import type { InputFile } from "./types.ts";

export type ArchiveErrorCode = "invalid_archive" | "archive_too_large" | "too_many_entries";

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}

export type ExtractOptions = {
  /** Cap on the unpacked size, enforced while inflating so a small archive can't balloon. */
  maxUncompressedBytes?: number;
  maxEntries?: number;
};

export type ExtractedArchive = {
  files: InputFile[];
  /** The commit GitHub recorded in the archive's global header, when present. */
  commitSha: string | null;
  /** Entries dropped because their path could escape the repository root. */
  unsafeEntries: number;
  /** Symlinks, hard links, devices and other entries that aren't plain files. */
  unsupportedEntries: number;
};

const BLOCK = 512;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 200_000;

/**
 * Unpacks a gzipped tar archive into in-memory files. Nothing is written to disk, so a
 * hostile path can't land anywhere; links and special entries are counted and dropped.
 * The leading directory GitHub wraps around the tree is removed.
 */
export function extractTarGz(archive: Uint8Array, options: ExtractOptions = {}): ExtractedArchive {
  const maxBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  let tar: Uint8Array;
  try {
    tar = gunzipSync(archive, { maxOutputLength: maxBytes });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new ArchiveError("archive_too_large", "The archive unpacks past the size limit.");
    }
    throw new ArchiveError("invalid_archive", "The archive is not a valid gzip file.");
  }

  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let commitSha: string | null = null;
  let unsafeEntries = 0;
  let unsupportedEntries = 0;
  let entries = 0;
  let nextPath: string | null = null;
  let nextSize: number | null = null;
  let offset = 0;
  let sawEnd = false;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      sawEnd = true;
      break;
    }
    if (!hasValidChecksum(header)) {
      throw new ArchiveError("invalid_archive", "The archive has a corrupt header.");
    }

    const type = String.fromCharCode(header[156] || 48);
    let size = readNumber(header.subarray(124, 136));
    if (size === null) throw new ArchiveError("invalid_archive", "The archive has a bad entry size.");
    const dataStart = offset + BLOCK;

    if (type === "x" || type === "g" || type === "L") {
      const text = decoder.decode(tar.subarray(dataStart, dataStart + size));
      if (type === "L") {
        nextPath = text.replace(/\0.*$/s, "");
      } else {
        const records = parsePax(text);
        if (type === "g") commitSha = records.get("comment") ?? commitSha;
        else {
          nextPath = records.get("path") ?? nextPath;
          const paxSize = records.get("size");
          if (paxSize !== undefined) nextSize = Number(paxSize);
        }
      }
      offset = dataStart + roundUp(size);
      continue;
    }

    if (nextSize !== null) {
      if (!Number.isSafeInteger(nextSize) || nextSize < 0) {
        throw new ArchiveError("invalid_archive", "The archive has a bad entry size.");
      }
      size = nextSize;
    }

    if (++entries > maxEntries) {
      throw new ArchiveError("too_many_entries", "The archive holds too many entries.");
    }
    if (dataStart + size > tar.length) {
      throw new ArchiveError("invalid_archive", "The archive ends in the middle of a file.");
    }

    const rawPath = nextPath ?? readPath(header);
    nextPath = null;
    nextSize = null;

    if (type === "0") {
      const path = normalizePath(rawPath);
      if (path === null) unsafeEntries++;
      else if (path !== "") files.set(path, tar.slice(dataStart, dataStart + size));
    } else if (type !== "5") {
      unsupportedEntries++;
    }

    offset = dataStart + roundUp(size);
  }

  if (!sawEnd && offset < tar.length) {
    throw new ArchiveError("invalid_archive", "The archive ends unexpectedly.");
  }

  return {
    files: [...files].map(([path, bytes]) => ({ path, bytes })),
    commitSha,
    unsafeEntries,
    unsupportedEntries,
  };
}

/** Drops the wrapper directory and rejects anything that could leave the root. */
function normalizePath(raw: string): string | null {
  if (raw.includes("\0") || raw.includes("\\") || raw.startsWith("/")) return null;
  const parts = raw.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === ".." || part === ".")) return null;
  return parts.slice(1).join("/");
}

function readPath(header: Uint8Array): string {
  const name = readString(header.subarray(0, 100));
  const isUstar = readString(header.subarray(257, 262)) === "ustar";
  const prefix = isUstar ? readString(header.subarray(345, 500)) : "";
  return prefix ? `${prefix}/${name}` : name;
}

function readString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function readNumber(field: Uint8Array): number | null {
  if (field[0]! & 0x80) {
    // GNU base-256 encoding, used for sizes that don't fit in octal.
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return Number.isSafeInteger(value) ? value : null;
  }
  const text = readString(field).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

function hasValidChecksum(header: Uint8Array): boolean {
  const stored = readNumber(header.subarray(148, 156));
  if (stored === null) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  return sum === stored;
}

function parsePax(text: string): Map<string, string> {
  const records = new Map<string, string>();
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  let pos = 0;
  while (pos < bytes.length) {
    const space = bytes.indexOf(32, pos);
    if (space === -1) break;
    const length = Number(decoder.decode(bytes.subarray(pos, space)));
    if (!Number.isInteger(length) || length <= space - pos) break;
    const record = decoder.decode(bytes.subarray(space + 1, pos + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    pos += length;
  }
  return records;
}

function roundUp(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}
