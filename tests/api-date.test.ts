import { afterEach, expect, test, vi } from 'vitest';

// The background refresh asks for "today's" week without naming a date. That
// default was the UTC day, so just after midnight in Berlin it fetched
// yesterday — the week before, on a Monday.

vi.mock('../src/storage', () => ({
    getSettings: async () => ({ workspace: 'https://studio.zebu.work', token: 'tok' }),
    saveSettings: async () => {},
}));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('the default timesheet date is the local day, not the UTC one', async () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T22:30:00Z')); // 00:30 on Monday 19 Oct in Berlin
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const { api } = await import('../src/api');
    await api.timesheet();

    expect(fetch).toHaveBeenCalledWith('https://studio.zebu.work/api/timesheet?date=2026-10-19', expect.anything());
});
