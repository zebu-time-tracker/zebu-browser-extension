import { backoffMs, parseFrame, payloadOf, readBroadcast, shouldRefetch, socketIdOf, socketUrl, subscribeFrame, timerChangedOf } from '../src/live';

const config = { key: 'abc', host: null, port: 443, scheme: 'https' as const, channel: 'timers.studio.7' };

test('the broadcast block is read defensively; anything short of a key and a channel means keep polling', () => {
    expect(readBroadcast(null)).toBeNull();
    expect(readBroadcast('x')).toBeNull();
    expect(readBroadcast({ key: 'abc' })).toBeNull();
    expect(readBroadcast({ key: 'abc', host: '', port: '8080', scheme: 'http', channel: 'timers.local.1' })).toEqual({ key: 'abc', host: null, port: 8080, scheme: 'http', channel: 'timers.local.1' });
    expect(readBroadcast({ key: 'abc', host: 'ws.zebu.work', port: 'junk', scheme: 'weird', channel: 'c' })).toEqual({ key: 'abc', host: 'ws.zebu.work', port: 443, scheme: 'https', channel: 'c' });
});

test('the socket opens on the workspace host unless the server named another', () => {
    expect(socketUrl(config, 'https://studio.zebu.work', '0.2.0')).toBe('wss://studio.zebu.work:443/app/abc?protocol=7&client=zebu-extension&version=0.2.0');
    expect(socketUrl({ ...config, host: '127.0.0.1', port: 8080, scheme: 'http' }, 'http://localhost:8003', '0.2.0')).toBe('ws://127.0.0.1:8080/app/abc?protocol=7&client=zebu-extension&version=0.2.0');
});

test('frames are parsed, and their string payloads unwrapped', () => {
    expect(parseFrame('nope')).toBeNull();
    expect(parseFrame(JSON.stringify({ data: {} }))).toBeNull();
    const hello = parseFrame(JSON.stringify({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: '12.34', activity_timeout: 30 }) }))!;
    expect(socketIdOf(hello)).toBe('12.34');
    expect(socketIdOf(parseFrame(JSON.stringify({ event: 'pusher:ping', data: {} }))!)).toBeNull();
    expect(payloadOf({ event: 'x', data: 'not json' })).toBeNull();
});

test('the timer event is the pulse, pushed', () => {
    const frame = parseFrame(JSON.stringify({ event: 'timer.changed', channel: 'private-timers.studio.7', data: JSON.stringify({ token: 'tok-2', running: true, at: '2026-09-19T06:30:06+00:00' }) }))!;
    expect(timerChangedOf(frame)).toEqual({ token: 'tok-2', running: true, at: '2026-09-19T06:30:06+00:00' });
    expect(timerChangedOf({ event: 'timer.changed', data: JSON.stringify({ token: null, running: null, at: 'x' }) })).toEqual({ token: null, running: null, at: 'x' });
    expect(timerChangedOf({ event: 'pusher:pong', data: {} })).toBeNull();
});

test('a pushed token that matches the held one means nothing to fetch; null or different means refetch', () => {
    expect(shouldRefetch('tok-1', 'tok-1')).toBe(false);
    expect(shouldRefetch('tok-2', 'tok-1')).toBe(true);
    expect(shouldRefetch(null, 'tok-1')).toBe(true);
    expect(shouldRefetch('tok-1', '')).toBe(true);
});

test('reconnects back off and cap; the subscribe frame names the private channel', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(JSON.parse(subscribeFrame('timers.studio.7', 'abc:sig'))).toEqual({ event: 'pusher:subscribe', data: { channel: 'private-timers.studio.7', auth: 'abc:sig' } });
});
