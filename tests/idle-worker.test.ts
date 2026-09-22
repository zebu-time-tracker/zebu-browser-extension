import { beforeEach, describe, expect, test, vi } from 'vitest';

// The service worker's half of idle detection (board #333): the server holds
// the absence, so what matters here is the order of the calls (ask before
// reporting), that every part of the notification answers the server with
// the prompt's own stretch and entry, and that a prompt answered elsewhere
// goes away.

const calls: string[] = [];
const idleState = vi.fn();
const idleTimer = vi.fn();
const reportActivity = vi.fn();
const timesheet = vi.fn();

vi.mock('../src/api', () => {
    class ApiError extends Error {
        constructor(
            message: string,
            public status: number,
        ) {
            super(message);
        }
    }
    return {
        ApiError,
        api: {
            timesheet: () => (calls.push('timesheet'), timesheet()),
            pulse: async () => ({ token: 'tok-1', running: true }),
            me: async () => ({}),
            idleState: () => (calls.push('idleState'), idleState()),
            idleTimer: (payload: unknown) => (calls.push('idleTimer'), idleTimer(payload)),
            reportActivity: (at?: string) => (calls.push('activity'), reportActivity(at)),
        },
    };
});

const running = { id: '01K-A', date: '2026-09-22', minutes: 0, notes: null, project: 'Acme', project_id: 'p1', task: null, task_id: null, is_billable: true, locked: false, timer_started_at: '2026-09-22T09:00:00+00:00' };
let pulseToken = 'tok-1';
timesheet.mockImplementation(async () => ({ week_start: '2026-09-21', entries: [running], running, projects: [], pulse_token: pulseToken, week_locked: false, project_stats: {} }));

const pending = {
    entry_id: '01K-A',
    timer_started_at: '2026-09-22T09:00:00+00:00',
    last_activity_at: '2026-09-22T09:03:00+00:00',
    idle_resolved_until: null,
    pending: false,
    idle_since: '2026-09-22T09:03:00+00:00',
    idle_until: null,
    idle_seconds: 7200,
};
const PROMPT_ID = `zebu-idle-${Date.parse('2026-09-22T09:03:00Z')}`;

const local: Record<string, unknown> = { settings: { workspace: 'https://studio.zebu.work', token: 'tok', idleEnabled: true, idleMinutes: 10 } };
const session: Record<string, unknown> = {};
const area = (store: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: store[key] }),
    set: async (obj: Record<string, unknown>) => void Object.assign(store, obj),
    remove: async (key: string) => void delete store[key],
});
const listeners: Record<string, (...args: never[]) => void> = {};
const on = (name: string) => ({ addListener: (fn: (...args: never[]) => void) => void (listeners[name] = fn) });
const shown: Record<string, { title: string; buttons?: { title: string }[] }> = {};
const windows: string[] = [];
let inputState = 'locked';

(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: () => undefined } },
    i18n: { getMessage: (key: string, subs: string[]) => [key, ...subs].join(' ') },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined, setIcon: async () => undefined, setTitle: async () => undefined },
    tabs: { query: async () => [], sendMessage: async () => undefined, update: async () => undefined },
    windows: { get: async () => Promise.reject(new Error('closed')), create: async (o: { url: string }) => (windows.push(o.url), { id: 1 }), update: async () => undefined },
    runtime: {
        getURL: (p: string) => p,
        getManifest: () => ({ version: '0.2.0' }),
        onMessage: { addListener: () => undefined },
        onInstalled: { addListener: () => undefined },
        onStartup: { addListener: () => undefined },
    },
    alarms: { get: async () => ({}), create: async () => undefined, onAlarm: on('alarm') },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined },
    contextMenus: { removeAll: async () => undefined, create: () => undefined, onClicked: { addListener: () => undefined } },
    commands: { onCommand: { addListener: () => undefined } },
    idle: { setDetectionInterval: () => undefined, queryState: async () => inputState, onStateChanged: on('idle') },
    notifications: {
        create: async (id: string, options: { title: string; buttons?: { title: string }[] }) => void (shown[id] = options),
        clear: async (id: string) => {
            const had = id in shown;
            delete shown[id];
            if (had) listeners.closed?.(id as never, false as never);
        },
        getAll: (cb: (all: object) => void) => cb({ ...shown }),
        onButtonClicked: on('button'),
        onClicked: on('clicked'),
        onClosed: on('closed'),
    },
};

const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

await import('../src/background');
await settle();

beforeEach(async () => {
    calls.length = 0;
    idleState.mockReset();
    idleTimer.mockReset();
    reportActivity.mockReset().mockResolvedValue(undefined);
    for (const key of Object.keys(shown)) delete shown[key];
    for (const key of Object.keys(session)) delete session[key];
    delete local.idlePrompt;
    windows.length = 0;
});

const comeBack = async () => {
    idleState.mockResolvedValue(pending);
    listeners.idle('active' as never);
    await settle();
};

describe('coming back', () => {
    test('asks the server before reporting, and prompts with the whole stretch and Harvest choices', async () => {
        await comeBack();
        expect(calls.indexOf('idleState')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('idleState')).toBeLessThan(calls.indexOf('activity'));
        expect(shown[PROMPT_ID].title).toBe('idle_title 2unit_hour');
        expect(shown[PROMPT_ID].buttons?.map((b) => b.title)).toEqual(['idle_remove_keep 2unit_hour', 'idle_remove_stop 2unit_hour']);
    });

    test('a stretch shorter than the setting is not asked about, but activity is still reported', async () => {
        idleState.mockResolvedValue({ ...pending, idle_seconds: 120 });
        listeners.idle('active' as never);
        await settle();
        expect(Object.keys(shown)).toEqual([]);
        expect(calls).toContain('activity');
    });

    test('with idle detection off, nothing is asked but activity is reported for the other devices', async () => {
        local.settings = { ...(local.settings as object), idleEnabled: false };
        try {
            listeners.idle('active' as never);
            await settle();
            expect(calls).not.toContain('idleState');
            expect(calls).toContain('activity');
        } finally {
            local.settings = { ...(local.settings as object), idleEnabled: true };
        }
    });

    test('unreachable after a wake: nothing is reported, so the next tick asks again', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
            const { ApiError } = await import('../src/api');
            idleState.mockRejectedValue(new ApiError('unreachable', 0));
            listeners.idle('active' as never);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }
        expect(calls.filter((c) => c === 'idleState')).toHaveLength(2);
        expect(calls).not.toContain('activity');
        expect(session.idleActivity).toBeUndefined();
    });

    test('the minute alarm reports input at most once a minute, without asking again', async () => {
        await comeBack();
        calls.length = 0;
        inputState = 'active';
        try {
            listeners.alarm({ name: 'refresh' } as never);
            await settle();
        } finally {
            inputState = 'locked';
        }
        expect(calls).not.toContain('idleState');
        expect(calls).not.toContain('activity');
    });
});

describe('answering', () => {
    test('a button removes the stretch for that entry, and the prompt goes', async () => {
        await comeBack();
        idleTimer.mockResolvedValue({ applied: true, entry: running, idle: { started_at: pending.idle_since, ended_at: '2026-09-22T11:03:00+00:00', minutes: 120 } });
        listeners.button(PROMPT_ID as never, 1 as never);
        await settle();
        expect(idleTimer).toHaveBeenCalledWith({ idle_started_at: pending.idle_since, action: 'discard_stop', entry_id: '01K-A' });
        expect(shown[PROMPT_ID]).toBeUndefined();
        expect(local.idlePrompt).toBeUndefined();
        expect(calls.filter((c) => c === 'idleTimer')).toHaveLength(1); // clearing it is not read as "keep"
    });

    test('clicking it adds the stretch as a new entry: the form opens prefilled', async () => {
        await comeBack();
        idleTimer.mockResolvedValue({ applied: true, entry: null, idle: { started_at: '2026-09-22T09:03:00', ended_at: '2026-09-22T11:03:00', minutes: 120 } });
        listeners.clicked(PROMPT_ID as never);
        await settle();
        expect(idleTimer).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard_new_entry' }));
        expect(windows).toEqual(['popup.html?window=1&date=2026-09-22&minutes=120']);
    });

    test('answered first elsewhere: no form', async () => {
        await comeBack();
        idleTimer.mockResolvedValue({ applied: false, entry: null, idle: null });
        listeners.clicked(PROMPT_ID as never);
        await settle();
        expect(windows).toEqual([]);
    });

    test('closing it keeps the time, and says so', async () => {
        await comeBack();
        idleTimer.mockResolvedValue({ applied: true, entry: running, idle: null });
        listeners.closed(PROMPT_ID as never, true as never);
        await settle();
        expect(idleTimer).toHaveBeenCalledWith(expect.objectContaining({ action: 'keep', entry_id: '01K-A' }));
    });
});

test('a change pushed from another device closes a prompt answered there', async () => {
    await comeBack();
    expect(shown[PROMPT_ID]).toBeDefined();
    idleState.mockResolvedValue({ ...pending, idle_since: '2026-09-22T11:05:00+00:00', idle_seconds: 3 });
    pulseToken = 'tok-2';
    const { refresh } = await import('../src/background');
    await refresh(true);
    await settle();
    expect(shown[PROMPT_ID]).toBeUndefined();
    expect(idleTimer).not.toHaveBeenCalled();
});
