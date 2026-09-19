// Insights with the running timer added on top, the desktop's arithmetic.
import { liveSummary, mondayOf } from '../src/summary';
import type { Entry, Summary } from '../src/types';

const base = (): Summary => ({
    today: 60,
    yesterday: 0,
    this_week: 100,
    last_week: 0,
    this_month: 200,
    last_month: 0,
    billable_pct_month: 50,
    month_by_day: Array(30).fill(0),
    year_by_month: Array(12).fill(0),
    uninvoiced_minutes: 10,
    uninvoiced_amounts: {},
    uninvoiced_total: 0,
    base_currency: 'EUR',
});

const running = (date: string, is_billable = true): Entry => ({
    id: 'e1',
    date,
    minutes: 5,
    notes: null,
    project: 'P',
    project_id: 'p1',
    task: null,
    task_id: null,
    is_billable,
    locked: false,
    timer_started_at: `${date}T10:00:00Z`,
});

const TODAY = '2026-09-18';
const now = (date: string) => Date.parse(`${date}T10:20:00Z`); // 20 minutes on the clock beyond the 5 banked

test('weeks start on Monday', () => {
    expect(mondayOf('2026-09-18')).toBe('2026-09-14');
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
    expect(mondayOf('2026-09-20')).toBe('2026-09-14');
});

test('a running timer today counts up in every figure it belongs to', () => {
    const live = liveSummary(base(), running(TODAY), TODAY, now(TODAY));

    expect(live.today).toBe(80);
    expect(live.this_week).toBe(120);
    expect(live.this_month).toBe(220);
    expect(live.uninvoiced_minutes).toBe(30);
    expect(live.month_by_day[17]).toBe(20);
    expect(live.year_by_month[8]).toBe(20);
});

test('nothing running, or nothing accrued yet, leaves the summary as the server sent it', () => {
    const s = base();
    expect(liveSummary(s, null, TODAY, now(TODAY))).toBe(s);
    expect(liveSummary(s, running(TODAY), TODAY, Date.parse(`${TODAY}T10:00:00Z`))).toBe(s);
});

test('a timer left running from last month only lands where it belongs', () => {
    const live = liveSummary(base(), running('2026-08-31'), TODAY, now('2026-08-31'));

    expect(live.today).toBe(60);
    expect(live.this_week).toBe(100);
    expect(live.this_month).toBe(200);
    expect(live.uninvoiced_minutes).toBe(10);
    expect(live.month_by_day.every((m) => m === 0)).toBe(true);
    expect(live.year_by_month[7]).toBe(20);
});

test('non-billable time never adds to the uninvoiced figure', () => {
    expect(liveSummary(base(), running(TODAY, false), TODAY, now(TODAY)).uninvoiced_minutes).toBe(10);
});
