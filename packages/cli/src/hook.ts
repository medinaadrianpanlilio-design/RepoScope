type Settings = Record<string, unknown>;
type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string }[] };

/** Adds the sync hook to a Claude Code settings object, leaving everything else alone. */
export function withSessionHook(settings: Settings, command: string): Settings {
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const sessionStart = hooks.SessionStart ?? [];

  if (sessionStart.some((group) => group.hooks?.some((hook) => hook.command === command))) {
    return settings;
  }

  return {
    ...settings,
    hooks: {
      ...hooks,
      SessionStart: [
        ...sessionStart,
        { matcher: "startup|resume", hooks: [{ type: "command", command }] },
      ],
    },
  };
}
