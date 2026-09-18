// Durations as the popup shows and reads them, the same rules as the desktop
// app's src/duration.ts (board #267). Pure functions, unit-tested.

/** Clock-style "h:mm" — entry rows and the day total. */
export function formatMinutes(minutes: number): string {
    const m = Math.max(0, Math.round(minutes));
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "1:30", "1.5", "90m" → minutes; null for anything else. */
export function parseDuration(input: string): number | null {
    const s = input.trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    m = s.match(/^(\d+)m$/);
    if (m) return parseInt(m[1]);
    m = s.match(/^(\d+(?:[.,]\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    return null;
}

/**
 * An entry's minutes as of `now`: the banked total, plus what a running timer
 * has added since it started. `now` is the server's clock (see State.skewMs).
 */
export function elapsedMinutes(entry: { minutes: number; timer_started_at: string | null }, now: number): number {
    if (!entry.timer_started_at) return entry.minutes;
    return entry.minutes + Math.max(0, (now - new Date(entry.timer_started_at).getTime()) / 60000);
}

export interface DurationUnits {
    hour: string;
    minute: string;
    day: string;
    week: string;
}

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Totals at two units of precision, stepping up as they grow so a long
 * absence or an uninvoiced pile never reads "500h 9m": "4h 5m", "2d 3h",
 * "1w 2d". Days are calendar days and weeks seven of them. The unit labels
 * come from the locale.
 */
export function formatDurationHuman(minutes: number, units: DurationUnits): string {
    const total = Math.max(0, Math.round(minutes));
    const pair = (big: number, bigUnit: string, small: number, smallUnit: string) => (small > 0 ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`);

    if (total >= WEEK) return pair(Math.floor(total / WEEK), units.week, Math.floor((total % WEEK) / DAY), units.day);
    if (total >= DAY) return pair(Math.floor(total / DAY), units.day, Math.floor((total % DAY) / HOUR), units.hour);
    if (total >= HOUR) return pair(Math.floor(total / HOUR), units.hour, total % HOUR, units.minute);
    return `${total}${units.minute}`;
}
