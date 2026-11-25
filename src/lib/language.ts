// UI language: an explicit Settings -> Language choice, or "auto" = the OS.
//
// "auto" used to be navigator.language alone, which Windows' WebView2 can
// report as English on a Japanese setup -- Windows users got an English-only
// UI while macOS was Japanese (reported 2026-11-25). The Rust side now also
// reports the OS's own settings (get_os_locales: Windows display language
// and regional format), and Japanese in either wins.

import type { Lang } from "../utils/i18n";

export type LangChoice = "auto" | "ja" | "en";
export const LANGUAGE_STORAGE_KEY = "agent-deck-language";

const isJa = (locale: string | null | undefined) => !!locale && /^ja([-_.]|$)/i.test(locale.trim());

export function resolveLang(choice: LangChoice, osLocales: readonly string[], navigatorLanguage: string | undefined): Lang {
  if (choice === "ja" || choice === "en") return choice;
  if (osLocales.some(isJa)) return "ja";
  return isJa(navigatorLanguage) ? "ja" : "en";
}

export function loadLangChoice(): LangChoice {
  try {
    const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return v === "ja" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveLangChoice(choice: LangChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, choice);
  } catch {
    // storage unavailable: the choice just lasts for this run
  }
}

export function parseLangChoice(value: unknown): LangChoice | null {
  return value === "auto" || value === "ja" || value === "en" ? value : null;
}

// The language currently shown, for code outside React state (status
// messages built in hooks). App keeps it up to date.
let current: Lang = resolveLang(loadLangChoice(), [], typeof navigator !== "undefined" ? navigator.language : undefined);
export const getLang = (): Lang => current;
export const setCurrentLang = (lang: Lang): void => {
  current = lang;
};
