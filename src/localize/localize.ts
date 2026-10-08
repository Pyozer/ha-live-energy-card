import type { HomeAssistant } from '../types';
import { en } from './en';
import { fr } from './fr';

export type Strings = typeof en;

/** Available translations. To add one, create `xx.ts` typed against `en` and register it here. */
const LANGUAGES = { en, fr } satisfies Record<string, Strings>;

export type Language = keyof typeof LANGUAGES;

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES) as Language[];

/** Native language names, shown in the editor. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'Français' };

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];

export type LocalizeKey = Path<Strings>;

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function localize(
  language: string | undefined,
  key: LocalizeKey,
  vars?: Record<string, string>,
): string {
  const lang = (language ?? 'en').split('-')[0].toLowerCase();
  const dict = (LANGUAGES as Record<string, Strings>)[lang];
  let text = lookup(dict, key) ?? lookup(en, key) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  }
  return text;
}

/**
 * Language of the card labels: the one set in the card configuration, otherwise the language of
 * the logged-in Home Assistant user (profile locale first, then the server language).
 */
export function resolveLanguage(
  configured: string | undefined,
  hass: Pick<HomeAssistant, 'language' | 'locale'> | undefined,
): string {
  if (configured && configured !== 'auto') return configured;
  return hass?.locale?.language ?? hass?.language ?? 'en';
}
