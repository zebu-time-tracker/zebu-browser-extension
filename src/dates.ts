// Calendar dates as the API writes them, "YYYY-MM-DD" in the user's local
// day. Pure functions, unit-tested (board #267).

export function toDateString(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The date `days` calendar days from `date`; negative goes back. */
export function shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    return toDateString(d);
}

/** Whole days from `from` to `to`, DST-proof (counted in UTC). */
export function daysBetween(from: string, to: string): number {
    const utc = (s: string) => {
        const [y, m, d] = s.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Does the timesheet week starting `weekStart` hold `date`? */
export function inWeek(date: string, weekStart: string): boolean {
    if (!weekStart) return false;
    const offset = daysBetween(weekStart, date);
    return offset >= 0 && offset < 7;
}

/**
 * How long ago `date` was, in words relative to `today`: "yesterday",
 * "3 days ago", "2 weeks ago", "last month" (board #411). Intl does the
 * wording, so every locale gets it translated.
 */
export function relativeDay(date: string, today: string, locale?: string): string {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const days = daysBetween(date, today);
    if (days < 7) return rtf.format(-days, 'day');
    if (days < 30) return rtf.format(-Math.round(days / 7), 'week');
    const [y, m] = date.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    const months = Math.max(1, (ty - y) * 12 + (tm - m));
    if (months < 12) return rtf.format(-months, 'month');
    return rtf.format(-Math.floor(months / 12), 'year');
}

/**
 * A day as the popup header names it (board #422): short weekday, month and
 * day in `locale`, "Thu Sep 24". Intl's comma after a leading weekday is
 * dropped, so "Today, Thu Sep 24" carries one comma, not two.
 */
export function headerDate(date: string, locale?: string): string {
    const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(`${date}T00:00:00`));
    return parts
        .map((p, i) => (p.type === 'literal' && parts[i - 1]?.type === 'weekday' && /^,\s*$/.test(p.value) ? ' ' : p.value))
        .join('');
}
