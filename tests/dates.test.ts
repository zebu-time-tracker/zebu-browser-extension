import { daysBetween, inWeek, relativeDay, shiftDate, toDateString } from '../src/dates';

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

test('an older day reads as how long ago it was (board #411)', () => {
    const today = '2026-09-24';
    expect(relativeDay('2026-09-24', today, 'en')).toBe('today');
    expect(relativeDay('2026-09-23', today, 'en')).toBe('yesterday');
    expect(relativeDay('2026-09-21', today, 'en')).toBe('3 days ago');
    expect(relativeDay('2026-09-17', today, 'en')).toBe('last week');
    expect(relativeDay('2026-09-10', today, 'en')).toBe('2 weeks ago');
    expect(relativeDay('2026-08-20', today, 'en')).toBe('last month');
    expect(relativeDay('2026-07-01', today, 'en')).toBe('2 months ago');
    expect(relativeDay('2025-06-01', today, 'en')).toBe('last year');
    expect(relativeDay('2026-09-23', today, 'de')).toBe('gestern');
});
