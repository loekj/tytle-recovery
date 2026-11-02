// SPDX-License-Identifier: GPL-3.0-only
//
// Money, fees and dates in the user's language. Money is shown in whole cents,
// rounded down: the page never shows more than the account holds.

import { formatEther } from 'viem';
import { EURE_DECIMALS } from './config.ts';

const CENT = 10n ** BigInt(EURE_DECIMALS - 2);

/** Euros in the language's own style: €2,340.00 (en), 2340,00 € (pt-PT). */
export function formatEuro(amount: bigint, locale: string): string {
  const cents = amount / CENT;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
}

/** True when the amount is above 0 but below one cent: shown as "less than €0.01". */
export function isBelowOneCent(amount: bigint): boolean {
  return amount > 0n && amount < CENT;
}

/** xDAI with at most 6 decimals, rounded up so a fee is never shown too small. */
export function formatXdai(wei: bigint, locale: string): string {
  const unit = 10n ** 12n;
  const rounded = ((wei + unit - 1n) / unit) * unit;
  const n = Number(formatEther(rounded));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n)} xDAI`;
}

/** A chain time (Unix seconds) as a date and time on this device's clock and time zone. */
export function formatDateTime(unixSeconds: bigint, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(Number(unixSeconds) * 1000));
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
