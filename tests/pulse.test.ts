import { beforeEach, describe, expect, test, vi } from 'vitest';

// The service worker used to hold a timesheet for five minutes and ask for a
// new one once a minute, so the detached timer window could count a timer that
// had been stopped elsewhere long before (board #49). It now asks a one-query
// endpoint whether anything changed, and refetches only when it has.

const timesheet = vi.fn();
const pulseCall = vi.fn();

vi.mock('../src/api', () => {
    class ApiError extends Error {
        constructor(
            message: string,
            public status: number,
        ) {
            super(message);
        }
    }

    return { ApiError, api: { timesheet: () => timesheet(), pulse: () => pulseCall() } };
});

const settings = { workspace: 'https://studio.app.zebu.work', token: 'tok' };

const alarms = new Map<string, unknown>();

const chromeStub = {
    storage: {
        local: { get: async () => ({ settings }), set: async () => undefined },
        session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
        onChanged: { addListener: () => undefined },
    },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    tabs: { query: async () => [], sendMessage: async () => undefined, update: async () => undefined },
    windows: { get: async () => undefined, create: async () => ({ id: 1 }), update: async () => undefined },
    runtime: {
        getURL: (p: string) => p,
        onMessage: { addListener: () => undefined },
        onInstalled: { addListener: () => undefined },
        onStartup: { addListener: () => undefined },
        openOptionsPage: async () => undefined,
    },
    alarms: {
        get: async (name: string) => alarms.get(name),
        create: async (name: string, info: unknown) => void alarms.set(name, info),
        onAlarm: { addListener: () => undefined },
    },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined },
    contextMenus: { removeAll: async () => undefined, create: () => undefined, onClicked: { addListener: () => undefined } },
};

// The module registers its listeners on import, so the stub has to be in place first.
(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
const background = await import('../src/background');

const sheet = (running: unknown, token: string, serverTime?: string) => ({
    week_start: '2026-09-07',
    entries: [],
    running,
    projects: [],
    pulse_token: token,
    server_time: serverTime,
});

const entry = { id: 'e1', timer_started_at: '2026-09-11T10:00:00+00:00', minutes: 0 };

beforeEach(() => {
    timesheet.mockReset();
    pulseCall.mockReset();
    alarms.clear();
});

describe('pulse', () => {
    test('an unchanged token costs one cheap call and no timesheet', async () => {
        timesheet.mockResolvedValue(sheet(entry, 'tok-1'));
        await background.refresh(true);
        expect(timesheet).toHaveBeenCalledTimes(1);

        pulseCall.mockResolvedValue({ token: 'tok-1', running: true });
        const state = await background.pulse();

        expect(timesheet).toHaveBeenCalledTimes(1);
        expect(state.running).toEqual(entry);
    });

    test('a moved token refetches, so a timer stopped elsewhere stops here', async () => {
        timesheet.mockResolvedValue(sheet(entry, 'tok-1'));
        await background.refresh(true);

        pulseCall.mockResolvedValue({ token: 'tok-2', running: false });
        timesheet.mockResolvedValue(sheet(null, 'tok-2'));
        const state = await background.pulse();

        expect(timesheet).toHaveBeenCalledTimes(2);
        expect(state.running).toBeNull();
    });

    test('an unanswerable pulse refetches rather than leaving a stale clock running', async () => {
        timesheet.mockResolvedValue(sheet(entry, 'tok-1'));
        await background.refresh(true);

        pulseCall.mockRejectedValue(new Error('unreachable'));
        timesheet.mockResolvedValue(sheet(null, 'tok-3'));
        const state = await background.pulse();

        expect(timesheet).toHaveBeenCalledTimes(2);
        expect(state.running).toBeNull();
    });
});

describe('refresh', () => {
    test('a cached state is served without asking again, but only briefly', async () => {
        timesheet.mockResolvedValue(sheet(entry, 'tok-1'));
        await background.refresh(true);
        await background.refresh();

        expect(timesheet).toHaveBeenCalledTimes(1);
    });

    test('the server clock is kept as a drift, so a fast browser does not invent minutes', async () => {
        vi.setSystemTime(new Date('2026-09-11T10:05:00Z'));
        timesheet.mockResolvedValue(sheet(entry, 'tok-1', '2026-09-11T10:00:00+00:00'));

        const state = await background.refresh(true);

        expect(state.skewMs).toBe(5 * 60 * 1000);
        vi.useRealTimers();
    });

    test('no server time means no correction, rather than a guess', async () => {
        timesheet.mockResolvedValue(sheet(entry, 'tok-1'));

        expect((await background.refresh(true)).skewMs).toBe(0);
    });
});

test('the refresh alarm is created once, not on every service-worker start', async () => {
    // Re-creating an alarm resets its schedule; the worker wakes for every
    // message, so the old unconditional create could push the next fire away
    // indefinitely on a busy browser.
    const first = alarms.get('refresh');
    await background.ensureRefreshAlarm();
    await background.ensureRefreshAlarm();

    expect(alarms.get('refresh')).toEqual(first ?? { periodInMinutes: 1 });
    expect([...alarms.keys()]).toEqual(['refresh']);
});
