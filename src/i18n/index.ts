import { enUS } from "./locales/en-US";
import { ko } from "./locales/ko";
import { LocaleStrings } from "./types";

// Re-export for convenience
export type { LocaleStrings } from "./types";

/**
 * All supported locale mappings.
 * Keys are Discord locale strings (https://discord.com/developers/docs/reference#locales).
 */
export const LOCALES: Record<string, LocaleStrings> = {
  "en-US": enUS,
  "en-GB": enUS,
  "ko": ko,
};

/**
 * Resolves the correct LocaleStrings object given:
 *  1. The guild's `language` config setting (highest priority unless "auto")
 *  2. Discord's guild locale (Community servers)
 *  3. Discord's user locale (personal language)
 *  4. Fallback to en-US
 */
export function getLocale(
  language: string,
  guildLocale?: string | null,
  userLocale?: string | null
): LocaleStrings {
  if (language !== "auto") return LOCALES[language] ?? LOCALES["en-US"];
  if (guildLocale && LOCALES[guildLocale]) return LOCALES[guildLocale];
  if (userLocale && LOCALES[userLocale]) return LOCALES[userLocale];
  return LOCALES["en-US"];
}

/**
 * Returns the locale key string (e.g. "ko", "en-US") for passing to Gemini.
 * Same resolution logic as getLocale but returns the key instead of the object.
 */
export function resolveLocaleKey(
  language: string,
  guildLocale?: string | null,
  userLocale?: string | null
): string {
  if (language !== "auto") return LOCALES[language] ? language : "en-US";
  if (guildLocale && LOCALES[guildLocale]) return guildLocale;
  if (userLocale && LOCALES[userLocale]) return userLocale;
  return "en-US";
}

/**
 * Simple positional %s string interpolation.
 * Usage: t("Hello %s, you have %s items", "user", 5) → "Hello user, you have 5 items"
 */
export function t(template: string, ...args: (string | number)[]): string {
  let i = 0;
  return template.replace(/%s/g, () => String(args[i++] ?? ""));
}

/**
 * Returns a display name for a language config value.
 */
export function getLanguageDisplayName(language: string): string {
  switch (language) {
    case "ko": return "🇰🇷 한국어";
    case "en-US": return "🇺🇸 English";
    default: return "🌐 Auto";
  }
}
