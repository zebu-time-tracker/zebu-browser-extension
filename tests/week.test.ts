// The week strip: seven columns from the sheet's week start, each with its day's total.
import { weekDays } from '../src/week';

const entry = (date: string, minutes: number, timer_started_at: string | null = null) => ({ date, minutes, timer_started_at });

test('seven days from the week start, each with its total', () => {
    const entries = [entry('2026-09-14', 60), entry('2026-09-14', 30), entry('2026-09-18', 10, '2026-09-18T10:00:00Z')];
    const now = Date.parse('2026-09-18T10:20:00Z');

    const days = weekDays('2026-09-14', entries, now, 'en');

    expect(days.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(days.map((d) => d.letter)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(days[0].minutes).toBe(90);
    expect(days[1].minutes).toBe(0);
    // a running timer counts up in the strip too
    expect(days[4].minutes).toBe(30);
});

test('no week fetched yet means no strip', () => {
    expect(weekDays('', [entry('2026-09-14', 60)], Date.now())).toEqual([]);
});
