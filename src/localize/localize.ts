import { en } from './en';
import { fr } from './fr';

export type Strings = typeof en;

const LANGUAGES: Record<string, Strings> = { en, fr };

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
  let text = lookup(LANGUAGES[lang], key) ?? lookup(en, key) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  }
  return text;
}
