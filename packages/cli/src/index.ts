#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFileSet, buildFileSet } from "../../engine/src/index.ts";
import { collectFiles } from "./collect.ts";
import { folderName, gitInfo, runnerFor } from "./git.ts";
import { withSessionHook } from "./hook.ts";
import { uploadResult } from "./upload.ts";

const DEFAULT_URL = "https://repo-scope-delta.vercel.app";
const CONFIG_DIR = join(homedir(), ".reposcope");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const LOG_FILE = join(CONFIG_DIR, "sync.log");
const THIS_FILE = fileURLToPath(import.meta.url);

type Config = { key?: string; url?: string };

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function login(key: string | undefined, url: string | undefined) {
  if (!key?.startsWith("rs_sync_")) throw new Error("Pass a sync key, which starts with rs_sync_.");
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), key, ...(url ? { url } : {}) }, null, 2));
  chmodSync(CONFIG_FILE, 0o600);
  console.log(`Saved your sync key to ${CONFIG_FILE}`);
}

async function sync(folder: string, quiet: boolean) {
  const config = readConfig();
  const key = process.env.REPOSCOPE_SYNC_KEY ?? config.key;
  const url = process.env.REPOSCOPE_URL ?? config.url ?? DEFAULT_URL;
  if (!key) throw new Error("No sync key. Run: reposcope login <sync key>");

  const git = runnerFor(folder);
  const info = await gitInfo(git);
  const fileSet = buildFileSet(await collectFiles(folder, git));

  if (fileSet.limitExceeded) {
    const { kind, limit, actual } = fileSet.limitExceeded;
    throw new Error(`Too large to sync: ${actual} over the ${kind} limit of ${limit}.`);
  }
  if (fileSet.sources.length === 0) throw new Error("No JavaScript or TypeScript files here.");

  const result = analyzeFileSet(fileSet);
  const outcome = await uploadResult({
    url,
    key,
    result,
    start: { name: folderName(folder), ...info },
  });

  if (!quiet) {
    console.log(
      outcome.uploaded
        ? `Synced ${result.files.length} files and ${result.edges.length} dependencies${info.dirty ? " (working copy)" : ""}.`
        : "Already up to date.",
    );
  }
}

/** Returns at once, so a coding session never waits for a sync. */
function detach(folder: string) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const log = openSync(LOG_FILE, "a");
  spawn(process.execPath, [THIS_FILE, "sync", folder, "--log"], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  }).unref();
}

function installHook(folder: string) {
  const file = join(folder, ".claude", "settings.local.json");
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const command = `node "${THIS_FILE.replace(/\\/g, "/")}" sync --detach`;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(withSessionHook(settings, command), null, 2)}\n`);
  console.log(`Claude Code will now sync this project when a session starts.\nChanged: ${file}`);
}

const USAGE = `RepoScope

  reposcope login <sync key> [url]   Save your sync key
  reposcope sync [folder]            Analyze a folder and upload the results
  reposcope install-hook [folder]    Sync whenever Claude Code starts in this folder

Only analysis results are uploaded. Your source code stays on this computer.`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = rest.filter((arg) => arg.startsWith("--"));
  const args = rest.filter((arg) => !arg.startsWith("--"));
  const folder = resolve(args[0] ?? process.cwd());

  if (command === "login") return login(args[0], args[1]);
  if (command === "install-hook") return installHook(folder);
  if (command !== "sync") return console.log(USAGE);

  if (flags.includes("--detach")) return detach(folder);

  try {
    await sync(folder, flags.includes("--log"));
    if (flags.includes("--log")) console.log(`${new Date().toISOString()} synced ${folder}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    if (flags.includes("--log")) console.log(`${new Date().toISOString()} ${folder}: ${message}`);
    else {
      console.error(message);
      process.exitCode = 1;
    }
  }
}

await main();
