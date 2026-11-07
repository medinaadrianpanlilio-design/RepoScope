"use client";

import { useSyncExternalStore } from "react";
import { checkLocalAi, DEFAULT_ENDPOINT, type LocalAiCheck } from "./local";

const STORAGE_KEY = "reposcope:local-ai";

export type LocalAiState =
  | { phase: "idle"; endpoint: string }
  | { phase: "checking"; endpoint: string }
  | { phase: "failed"; endpoint: string; reason: "unreachable" | "loading" }
  | { phase: "connected"; endpoint: string; model: string };

const IDLE: LocalAiState = { phase: "idle", endpoint: DEFAULT_ENDPOINT };

let state: LocalAiState = IDLE;
let resumed = false;
const listeners = new Set<() => void>();

function setState(next: LocalAiState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function savedEndpoint(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveEndpoint(endpoint: string | null) {
  try {
    if (endpoint) window.localStorage.setItem(STORAGE_KEY, endpoint);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The connection still works for this visit.
  }
}

function apply(endpoint: string, result: LocalAiCheck) {
  if (result.status === "connected") {
    saveEndpoint(endpoint);
    setState({ phase: "connected", endpoint, model: result.model });
  } else {
    setState({ phase: "failed", endpoint, reason: result.status });
  }
}

/**
 * Only runs after someone asks, because the first request to this machine makes the browser
 * show a permission prompt, and no visitor should see that without choosing local AI.
 */
export async function connectLocalAi(endpoint = state.endpoint) {
  setState({ phase: "checking", endpoint });
  apply(endpoint, await checkLocalAi(endpoint));
}

export function disconnectLocalAi() {
  saveEndpoint(null);
  setState(IDLE);
}

/** Someone who connected on an earlier visit has already allowed it. */
function resumeOnce() {
  if (resumed) return;
  resumed = true;
  const endpoint = savedEndpoint();
  if (!endpoint) return;

  void checkLocalAi(endpoint).then((result) => {
    if (result.status === "connected") apply(endpoint, result);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  resumeOnce();
  return () => listeners.delete(listener);
}

export function useLocalAi(): LocalAiState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}
