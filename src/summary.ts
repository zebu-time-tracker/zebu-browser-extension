// The Insights figures with the running timer added on top, so the tiles and
// charts count up with the clock instead of waiting for a stop — the same
// arithmetic as the desktop's src/Insights.vue. Pure, unit-tested.
import { shiftDate } from './dates';
import { elapsedMinutes } from './duration';
import type { Entry, Summary } from './types';

/** Monday of the week holding `date`, as the server counts weeks. */
export const mondayOf = (date: string): string => {
    const d = new Date(`${date}T00:00:00`);
    return shiftDate(date, -((d.getDay() + 6) % 7));
};

/**
 * `summary` plus what `running` has accrued beyond the stored minutes the
 * server already summed, in every total the timer belongs to. `today` is the
 * local date; `now` is the server's clock.
 */
export function liveSummary(summary: Summary, running: Entry | null, today: string, now: number): Summary {
    if (!running) return summary;
    const extra = Math.max(0, elapsedMinutes(running, now) - running.minutes);
    if (!extra) return summary;
    const [ry, rm, rd] = running.date.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    const live: Summary = { ...summary, month_by_day: [...summary.month_by_day], year_by_month: [...summary.year_by_month] };
    if (running.date === today) live.today += extra;
    if (mondayOf(running.date) === mondayOf(today)) live.this_week += extra;
    if (ry === ty && rm === tm) {
        live.this_month += extra;
        if (running.is_billable) live.uninvoiced_minutes += extra;
        if (rd - 1 < live.month_by_day.length) live.month_by_day[rd - 1] += extra;
    }
    if (ry === ty && rm - 1 < live.year_by_month.length) live.year_by_month[rm - 1] += extra;
    return live;
}
