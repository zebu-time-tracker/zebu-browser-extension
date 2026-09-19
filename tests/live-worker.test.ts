import { beforeEach, describe, expect, test, vi } from 'vitest';

// The service worker's half of live updates (board #279): a fake socket
// speaks the Pusher handshake and pushes frames; what matters is what the
// worker sends back, when it refetches, and that it reconnects after a drop.

const timesheet = vi.fn();
const pulseCall = vi.fn();
const broadcastingAuth = vi.fn();
const me = vi.fn();

vi.mock('../src/api', () => {
    class ApiError extends Error {
        constructor(
            message: string,
            public status: number,
        ) {
            super(message);
        }
    }
    return { ApiError, api: { timesheet: (date?: string) => timesheet(date), pulse: () => pulseCall(), broadcastingAuth: (id: string, channel: string) => broadcastingAuth(id, channel), me: () => me() } };
});

const settings = { workspace: 'https://studio.zebu.work', token: 'tok', broadcast: { key: 'abc', host: null, port: 443, scheme: 'https', channel: 'timers.studio.7' } };
const sent: string[] = [];
const sockets: FakeSocket[] = [];

class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FakeSocket.OPEN;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
        sockets.push(this);
    }
    send(frame: string) {
        sent.push(frame);
    }
    close() {
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.();
    }
    /** the server speaks */
    push(event: string, data: unknown, channel?: string) {
        this.onmessage?.({ data: JSON.stringify({ event, channel, data: typeof data === 'string' ? data : JSON.stringify(data) }) });
    }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

const stored: Record<string, unknown> = { settings };
const messages: unknown[] = [];
const chromeStub = {
    storage: {
        local: { get: async (key: string) => ({ [key]: stored[key] }), set: async (obj: Record<string, unknown>) => void Object.assign(stored, obj) },
        session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
        onChanged: { addListener: () => undefined },
    },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined, setIcon: async () => undefined, setTitle: async () => undefined },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (_id: number, m: unknown) => void messages.push(m), update: async () => undefined },
    windows: { get: async () => undefined, create: async () => ({ id: 1 }), update: async () => undefined },
    runtime: {
        getURL: (p: string) => p,
        getManifest: () => ({ version: '0.2.0' }),
        onMessage: { addListener: () => undefined },
        onInstalled: { addListener: () => undefined },
        onStartup: { addListener: () => undefined },
        openOptionsPage: async () => undefined,
    },
    alarms: { get: async () => undefined, create: async () => undefined, onAlarm: { addListener: () => undefined } },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined },
    contextMenus: { removeAll: async () => undefined, create: () => undefined, onClicked: { addListener: () => undefined } },
    commands: { onCommand: { addListener: () => undefined } },
    idle: { setDetectionInterval: () => undefined, onStateChanged: { addListener: () => undefined } },
    notifications: { create: async () => undefined, clear: () => undefined, onButtonClicked: { addListener: () => undefined }, onClosed: { addListener: () => undefined }, onClicked: { addListener: () => undefined } },
};
(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

const sheet = (token: string) => ({ week_start: '2026-09-14', entries: [], running: null, projects: [], pulse_token: token, week_locked: false, project_stats: {} });
const flush = () => new Promise((r) => setTimeout(r, 0));

timesheet.mockResolvedValue(sheet('tok-1'));
broadcastingAuth.mockResolvedValue({ auth: 'abc:sig' });
const background = await import('../src/background');

beforeEach(() => {
    sent.length = 0;
    messages.length = 0;
    timesheet.mockClear();
    broadcastingAuth.mockClear();
});

describe('the worker owns the socket', () => {
    test('it opens on import, authorises the private channel with the socket id, and subscribes', async () => {
        await flush();
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toBe('wss://studio.zebu.work:443/app/abc?protocol=7&client=zebu-extension&version=0.2.0');

        sockets[0].push('pusher:connection_established', { socket_id: '12.34', activity_timeout: 30 });
        await flush();
        expect(broadcastingAuth).toHaveBeenCalledWith('12.34', 'private-timers.studio.7');
        expect(JSON.parse(sent[0])).toEqual({ event: 'pusher:subscribe', data: { channel: 'private-timers.studio.7', auth: 'abc:sig' } });
    });

    test('once subscribed the state is live, and every page is told', async () => {
        await background.refresh(true);
        timesheet.mockClear();
        sockets[0].push('pusher_internal:subscription_succeeded', {}, 'private-timers.studio.7');
        await flush();
        expect((await background.refresh()).live).toBe(true);
        expect(messages.some((m) => (m as { state?: { live?: boolean } }).state?.live === true)).toBe(true);
        expect(timesheet).not.toHaveBeenCalled(); // no gap yet, nothing to catch up on
    });

    test('a pushed token that matches costs nothing but syncs the clock; a new one refetches', async () => {
        vi.setSystemTime(new Date('2026-09-19T06:30:05Z'));
        try {
            // the browser is five seconds ahead of the server's clock in the event
            sockets[0].push('timer.changed', { token: 'tok-1', running: false, at: '2026-09-19T06:30:00+00:00' }, 'private-timers.studio.7');
            await flush();
            expect(timesheet).not.toHaveBeenCalled();
            expect((await background.refresh()).skewMs).toBe(5000);

            timesheet.mockResolvedValue(sheet('tok-2'));
            sockets[0].push('timer.changed', { token: 'tok-2', running: true, at: '2026-09-19T06:30:00+00:00' }, 'private-timers.studio.7');
            await flush();
            expect(timesheet).toHaveBeenCalledTimes(1);
            expect((await background.refresh()).pulseToken).toBe('tok-2');
        } finally {
            vi.useRealTimers();
        }
    });

    test('pings are answered', async () => {
        sockets[0].push('pusher:ping', {});
        expect(JSON.parse(sent.at(-1)!)).toEqual({ event: 'pusher:pong', data: {} });
    });

    test('a drop goes back to polling, reconnects with backoff, and refetches once resubscribed', async () => {
        vi.useFakeTimers();
        sockets[0].close();
        await vi.advanceTimersByTimeAsync(0);
        expect((await background.refresh()).live).toBe(false);
        expect(sockets).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(sockets).toHaveLength(2);
        const next = sockets[1];
        next.push('pusher:connection_established', { socket_id: '56.78' });
        await vi.advanceTimersByTimeAsync(0);
        timesheet.mockClear();
        next.push('pusher_internal:subscription_succeeded', {}, 'private-timers.studio.7');
        await vi.advanceTimersByTimeAsync(0);
        expect(timesheet).toHaveBeenCalledTimes(1); // the gap
        expect((await background.refresh()).live).toBe(true);

        // and it keeps the worker alive with a ping every twenty seconds
        sent.length = 0;
        await vi.advanceTimersByTimeAsync(20_000);
        expect(JSON.parse(sent[0])).toEqual({ event: 'pusher:ping', data: {} });
        vi.useRealTimers();
    });
});

describe('learning that the workspace switched Reverb on after login', () => {
    test('while not live the block is asked for again, a few minutes apart, and saved when it changed', async () => {
        const { connectLive, relearnBroadcast, RELEARN_MS } = await import('../src/background');
        const block = { key: 'new', host: null, port: 443, scheme: 'https', channel: 'timers.studio.7' };
        stored.settings = { ...settings, broadcast: null };
        await connectLive(); // nothing to subscribe to: back to polling
        me.mockReset();
        me.mockResolvedValue({ name: 'A', email: 'a@x', broadcast: null });

        // an unchanged answer saves nothing...
        await relearnBroadcast(1_000_000);
        expect(me).toHaveBeenCalledTimes(1);
        expect((stored.settings as { broadcast: unknown }).broadcast).toBeNull();

        // ...and is not asked again straight away
        await relearnBroadcast(1_000_000 + RELEARN_MS - 1);
        expect(me).toHaveBeenCalledTimes(1);

        // once Reverb is on, the block is saved (the storage listener opens the socket from there)
        me.mockResolvedValue({ name: 'A', email: 'a@x', broadcast: block });
        await relearnBroadcast(1_000_000 + RELEARN_MS);
        expect(me).toHaveBeenCalledTimes(2);
        expect((stored.settings as { broadcast: unknown }).broadcast).toEqual(block);

        // a server that cannot be reached changes nothing
        stored.settings = { ...settings, broadcast: null };
        me.mockRejectedValue(new Error('unreachable'));
        await relearnBroadcast(1_000_000 + 2 * RELEARN_MS);
        expect((stored.settings as { broadcast: unknown }).broadcast).toBeNull();
    });
});
