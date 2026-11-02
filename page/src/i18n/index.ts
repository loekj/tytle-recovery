// SPDX-License-Identifier: GPL-3.0-only
//
// The page's four languages. The first visit picks the browser's language;
// the user can change it at the top of the page. The choice is not stored.

import { en, type Messages } from './en.ts';
import { es } from './es.ts';
import { ptBR } from './pt-BR.ts';
import { ptPT } from './pt-PT.ts';

export type Locale = 'en' | 'pt-PT' | 'pt-BR' | 'es';
export type MessageKey = keyof Messages;

export const LOCALES: Record<Locale, Messages> = { en, 'pt-PT': ptPT, 'pt-BR': ptBR, es };

/** The Intl locale for money and dates. */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-GB', 'pt-PT': 'pt-PT', 'pt-BR': 'pt-BR', es: 'es-ES' };

export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const t = tag.toLowerCase();
    if (t === 'pt-br') return 'pt-BR';
    if (t.startsWith('pt')) return 'pt-PT';
    if (t.startsWith('es')) return 'es';
    if (t.startsWith('en')) return 'en';
  }
  return 'en';
}

/** A text with its {name} values filled in. */
export function text(locale: Locale, key: MessageKey, values: Record<string, string> = {}): string {
  return LOCALES[locale][key].replace(/\{(\w+)\}/gu, (m, name: string) => values[name] ?? m);
}
