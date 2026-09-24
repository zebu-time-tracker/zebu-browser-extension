// The meta line under an entry row (board #420): "View project · Uninvoiced:
// 32h · Budget: 62%", worded as the desktop app words it. Pure, unit-tested.

/**
 * Uninvoiced time as a plain hour count: one decimal under 10h ("9.5h"),
 * whole hours from 10h ("32h"), "0h" when there is none. Anything above
 * zero shows at least 0.1h, so a few minutes never read as nothing.
 */
export function formatHoursShort(minutes: number, locale?: string): string {
    if (minutes <= 0) return '0h';
    const hours = minutes / 60;
    const shown = hours < 10 ? Math.max(0.1, Math.round(hours * 10) / 10) : Math.round(hours);
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(shown)}h`;
}

/** How loudly a budget reads: amber from 60% used, red from 80%. */
export const budgetLevel = (pct: number): 'ok' | 'warn' | 'over' => (pct >= 80 ? 'over' : pct >= 60 ? 'warn' : 'ok');
