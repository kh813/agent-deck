// Keeps the GUI's prompt panel (Yes/No/numbered-menu buttons) in step with
// the CLI's own prompt in the terminal.
//
// - Answered in the terminal: the panel used to stay up until the next prompt
//   replaced it. Keys that answer a CLI prompt now dismiss it.
// - Answered either way: the CLI redraws as it moves on, and a chunk can
//   still contain the old menu text, which the backend reports again. The
//   same prompt is ignored for a short while after it was answered.

export interface PromptLike {
  prompt_type: string;
  message: string;
  options?: string[];
}

// How long a just-answered prompt is ignored if the backend reports it again.
export const ANSWERED_PROMPT_GRACE_MS = 2000;

/**
 * True if this terminal input answers (or cancels) a CLI prompt: Enter, a
 * single digit (Claude Code's numbered menus select on the digit itself),
 * y/n, Esc, or Ctrl+C. Arrow keys and other typing only navigate or edit,
 * so they keep the panel up.
 */
export function answersPrompt(data: string): boolean {
  if (data.includes("\r") || data.includes("\n")) return true;
  if (data === "\x1b" || data === "\x03") return true;
  return /^[0-9yYnN]$/.test(data);
}

export function promptKey(p: PromptLike): string {
  return JSON.stringify([p.prompt_type, p.message, p.options ?? []]);
}

/** Should a newly reported prompt be ignored as a re-report of one just answered? */
export function isEchoOfAnswered(
  incoming: PromptLike,
  answered: { key: string; at: number } | null,
  now: number,
): boolean {
  return !!answered && answered.key === promptKey(incoming) && now - answered.at < ANSWERED_PROMPT_GRACE_MS;
}
