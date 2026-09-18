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
