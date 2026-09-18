import { elapsedMinutes, formatDurationHuman, formatMinutes, parseDuration } from '../src/duration';

test('formatMinutes is clock style h:mm', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(5)).toBe('0:05');
    expect(formatMinutes(90)).toBe('1:30');
    expect(formatMinutes(38 * 60 + 12)).toBe('38:12');
    expect(formatMinutes(89.7)).toBe('1:30');
    expect(formatMinutes(-3)).toBe('0:00');
});

test('parseDuration accepts h:mm, decimal hours and Nm', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('1,5')).toBe(90);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration(' 2 ')).toBe(120);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1:75')).toBe(135); // the minutes part is taken as written
});

test('a running entry counts up from its banked minutes', () => {
    const started = new Date('2026-09-18T10:00:00Z').getTime();
    expect(elapsedMinutes({ minutes: 30, timer_started_at: '2026-09-18T10:00:00Z' }, started + 15 * 60000)).toBe(45);
    expect(elapsedMinutes({ minutes: 30, timer_started_at: '2026-09-18T10:00:00Z' }, started - 60000)).toBe(30); // clock behind the server: never negative
    expect(elapsedMinutes({ minutes: 30, timer_started_at: null }, started + 15 * 60000)).toBe(30);
});

test('human totals step up through hours, days and weeks with the locale units', () => {
    const en = { hour: 'h', minute: 'm', day: 'd', week: 'w' };
    expect(formatDurationHuman(4 * 60 + 5, en)).toBe('4h 5m');
    expect(formatDurationHuman(8 * 60, en)).toBe('8h');
    expect(formatDurationHuman(24 * 60 + 59, en)).toBe('1d');
    expect(formatDurationHuman(38 * 60 + 12, en)).toBe('1d 14h');
    expect(formatDurationHuman(9 * 24 * 60 + 5 * 60, en)).toBe('1w 2d');
    expect(formatDurationHuman(45, en)).toBe('45m');
    expect(formatDurationHuman(0, en)).toBe('0m');
    expect(formatDurationHuman(3 * 60 + 12, { hour: '時間', minute: '分', day: '日', week: '週' })).toBe('3時間 12分');
});
