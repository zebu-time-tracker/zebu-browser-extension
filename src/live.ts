// Live timer updates over Reverb (board #279): the server pushes "your timer
// changed" the moment an entry is written, so a start on the phone or the web
// reaches this extension in about a hundred milliseconds instead of on the
// next pulse. The wire is the Pusher protocol (version 7) that Reverb speaks;
// this module is the pure half — URLs, frames and decisions — unit-tested,
// and the service worker owns the socket itself.
import type { BroadcastConfig } from './types';

/** The `broadcast` block of GET /api/me, made safe to use; null means "the server does not broadcast: keep polling". */
export function readBroadcast(value: unknown): BroadcastConfig | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.key !== 'string' || !v.key || typeof v.channel !== 'string' || !v.channel) return null;
    const port = Number(v.port);
    return {
        key: v.key,
        host: typeof v.host === 'string' && v.host ? v.host : null,
        port: Number.isFinite(port) && port > 0 ? port : 443,
        scheme: v.scheme === 'http' ? 'http' : 'https',
        channel: v.channel,
    };
}

/** Where to open the socket: the workspace's own host unless the server named another. */
export function socketUrl(config: BroadcastConfig, workspace: string, version: string): string {
    let host = config.host;
    if (!host) {
        try {
            host = new URL(workspace).hostname;
        } catch {
            host = '';
        }
    }
    const proto = config.scheme === 'http' ? 'ws' : 'wss';
    return `${proto}://${host}:${config.port}/app/${config.key}?protocol=7&client=zebu-extension&version=${encodeURIComponent(version)}`;
}

/** One frame off the wire. Pusher wraps event payloads as JSON *strings*, which `payloadOf` undoes. */
export interface LiveFrame {
    event: string;
    channel?: string;
    data?: unknown;
}

export function parseFrame(raw: unknown): LiveFrame | null {
    if (typeof raw !== 'string') return null;
    try {
        const frame = JSON.parse(raw) as Partial<LiveFrame>;
        return frame && typeof frame.event === 'string' ? (frame as LiveFrame) : null;
    } catch {
        return null;
    }
}

/** A frame's payload as an object, whether it came as one or as the JSON string Pusher usually sends. */
export function payloadOf(frame: LiveFrame): Record<string, unknown> | null {
    let data = frame.data;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch {
            return null;
        }
    }
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** The socket id Reverb hands out on connect, needed to authorise the private channel. */
export function socketIdOf(frame: LiveFrame): string | null {
    if (frame.event !== 'pusher:connection_established') return null;
    const id = payloadOf(frame)?.socket_id;
    return typeof id === 'string' && id ? id : null;
}

/** What the timer event carries: the pulse, pushed. A null token means "changed, refetch". */
export interface TimerChanged {
    token: string | null;
    running: boolean | null;
    at: string | null;
}

export function timerChangedOf(frame: LiveFrame): TimerChanged | null {
    if (frame.event !== 'timer.changed') return null;
    const data = payloadOf(frame) ?? {};
    return {
        token: typeof data.token === 'string' ? data.token : null,
        running: typeof data.running === 'boolean' ? data.running : null,
        at: typeof data.at === 'string' ? data.at : null,
    };
}

/** A pushed token that matches what the last fetch answered means nothing changed since; anything else means refetch. */
export const shouldRefetch = (pushed: string | null, held: string): boolean => pushed === null || pushed !== held;

/** Reconnect delays: 1 s, 2 s, 4 s … capped at 30 s, so a box that is down is not hammered and one that is back is noticed soon. */
export const backoffMs = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(attempt, 5)));

/**
 * A frame every twenty seconds keeps the service worker alive: since Chrome
 * 116 WebSocket activity extends its life, but only if something is sent or
 * received inside the thirty-second idle limit. Reverb answers every ping.
 */
export const KEEPALIVE_MS = 20_000;

export const PING = JSON.stringify({ event: 'pusher:ping', data: {} });
export const PONG = JSON.stringify({ event: 'pusher:pong', data: {} });
export const subscribeFrame = (channel: string, auth: string): string => JSON.stringify({ event: 'pusher:subscribe', data: { channel: `private-${channel}`, auth } });
