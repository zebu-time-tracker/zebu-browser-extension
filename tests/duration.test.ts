import { elapsedMinutes, formatMinutes, parseDuration } from '../src/duration';

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
