export interface EngineInstallState {
  installed: boolean;
}

/**
 * Decide which engine should be selected, given the configured engine ids
 * (in agent_config.json order), the detection results, and the current pick.
 *
 * - Before detection has produced any result, keep the current pick (or fall
 *   back to the first configured engine if the current one isn't configured).
 * - If the current pick is installed, keep it.
 * - Otherwise switch to the first *installed* engine in config order, so a
 *   machine that only has e.g. Claude Code installed lands on it instead of
 *   the agy-install onboarding screen.
 * - If nothing is installed, stay on a configured engine (onboarding shows).
 */
export function pickEngine(
  engineIds: string[],
  statuses: Record<string, EngineInstallState | undefined>,
  current: string | null | undefined,
): string | null {
  if (engineIds.length === 0) return current ?? null;
  const fallback = current && engineIds.includes(current) ? current : engineIds[0];
  const detected = engineIds.some((id) => statuses[id] !== undefined);
  if (!detected) return fallback;
  if (statuses[fallback]?.installed) return fallback;
  const firstInstalled = engineIds.find((id) => statuses[id]?.installed);
  return firstInstalled ?? fallback;
}

export const SELECTED_ENGINE_STORAGE_KEY = "selectedAgentId";

export function loadSavedEngine(): string | null {
  try {
    return localStorage.getItem(SELECTED_ENGINE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveEngine(id: string): void {
  try {
    localStorage.setItem(SELECTED_ENGINE_STORAGE_KEY, id);
  } catch {
    // storage unavailable (private mode etc.) -- selection just isn't remembered
  }
}
