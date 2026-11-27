// "A tab needs you" notifications (app_specs.md 5.7.4, task 17-6): when a
// tab you aren't looking at -- or any tab while agent-deck isn't the front
// window -- starts waiting at an approval prompt, notify once per prompt.

export interface PromptStateLike {
  activePrompt: { message?: string } | null;
}

export interface NotifyItem {
  sessionId: string;
  message: string;
}

/**
 * Which tabs to notify about now, and the updated "already notified" map
 * (session id -> prompt key). A prompt that went away is forgotten, so the
 * next one notifies again.
 */
export function promptNotifications(
  states: Record<string, PromptStateLike | undefined>,
  activeId: string,
  windowFocused: boolean,
  notified: Record<string, string>,
): { notify: NotifyItem[]; notified: Record<string, string> } {
  const next: Record<string, string> = {};
  const notify: NotifyItem[] = [];
  for (const [id, st] of Object.entries(states)) {
    const prompt = st?.activePrompt;
    if (!prompt) continue;
    const key = prompt.message ?? "";
    next[id] = key;
    const seen = notified[id] === key;
    const visible = id === activeId && windowFocused;
    if (!seen && !visible) notify.push({ sessionId: id, message: key });
    if (visible) next[id] = key; // looked at: don't notify for it later
  }
  return { notify, notified: next };
}
