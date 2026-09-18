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
