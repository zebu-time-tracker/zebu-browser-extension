import { daysBetween, inWeek, shiftDate, toDateString } from '../src/dates';

test('dates are written the way the API writes them', () => {
    expect(toDateString(new Date(2026, 8, 18))).toBe('2026-09-18');
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
});

test('shifting a day crosses months and years', () => {
    expect(shiftDate('2026-09-18', -1)).toBe('2026-09-17');
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30'); // across a DST change, still one day
});

test('a timesheet week holds its seven days and nothing else', () => {
    expect(daysBetween('2026-09-14', '2026-09-18')).toBe(4);
    expect(inWeek('2026-09-14', '2026-09-14')).toBe(true);
    expect(inWeek('2026-09-20', '2026-09-14')).toBe(true);
    expect(inWeek('2026-09-21', '2026-09-14')).toBe(false);
    expect(inWeek('2026-09-13', '2026-09-14')).toBe(false);
    expect(inWeek('2026-09-13', '')).toBe(false);
});
