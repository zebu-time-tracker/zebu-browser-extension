// The week strip under the popup's header, as the desktop draws it: one
// column per day from the sheet's week start, a letter and that day's total.
// Pure, unit-tested; the popup only renders what this returns.
import { shiftDate } from './dates';
import { elapsedMinutes } from './duration';

export interface WeekDay {
    date: string;
    /** The weekday's narrow name in the user's locale: "M", "T", "月". */
    letter: string;
    /** Minutes tracked that day, a running timer counting up. */
    minutes: number;
}

export function weekDays(
    weekStart: string,
    entries: { date: string; minutes: number; timer_started_at: string | null }[],
    now: number,
    locale: string | undefined = undefined,
): WeekDay[] {
    if (!weekStart) return [];
    const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => {
        const date = shiftDate(weekStart, i);
        return {
            date,
            letter: narrow.format(new Date(`${date}T00:00:00`)),
            minutes: entries.filter((e) => e.date === date).reduce((sum, e) => sum + elapsedMinutes(e, now), 0),
        };
    });
}
