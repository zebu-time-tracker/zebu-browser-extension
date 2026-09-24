import { budgetLevel, formatHoursShort } from '../src/entryStats';

test('uninvoiced time reads as a plain hour count (board #420)', () => {
    expect(formatHoursShort(0, 'en')).toBe('0h');
    expect(formatHoursShort(2, 'en')).toBe('0.1h');
    expect(formatHoursShort(90, 'en')).toBe('1.5h');
    expect(formatHoursShort(120, 'en')).toBe('2h');
    expect(formatHoursShort(9 * 60 + 30, 'en')).toBe('9.5h');
    expect(formatHoursShort(9 * 60 + 58, 'en')).toBe('10h');
    expect(formatHoursShort(10 * 60 + 10, 'en')).toBe('10h');
    expect(formatHoursShort(32 * 60 + 20, 'en')).toBe('32h');
    expect(formatHoursShort(41 * 60, 'en')).toBe('41h');
    expect(formatHoursShort(90, 'de')).toBe('1,5h');
});

test('a budget turns amber from 60% and red from 80%', () => {
    expect(budgetLevel(0)).toBe('ok');
    expect(budgetLevel(59)).toBe('ok');
    expect(budgetLevel(60)).toBe('warn');
    expect(budgetLevel(79)).toBe('warn');
    expect(budgetLevel(80)).toBe('over');
    expect(budgetLevel(130)).toBe('over');
});
