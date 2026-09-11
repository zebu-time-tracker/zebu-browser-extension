/**
 * Waiting out an outage the server announced (board #216).
 *
 * The server names a planned window on the timer pulse before it starts, then
 * answers 503 with `Retry-After` for its duration. This extension polls that
 * pulse several times a minute while a timer runs, so it is one of the clients
 * that should stop asking rather than discover the outage a request at a time.
 *
 * Pure decisions, so they can be tested without a service worker, a token or a
 * clock. Everything here answers in epoch milliseconds: "do not ask again
 * before this instant", which is the only thing the popup needs to know.
 */
import type { MaintenanceWindow } from './api';

/**
 * How long past the window's end to wait. The work finishes when it finishes,
 * rarely on the minute — and every client holds the same end time, so arriving
 * a little after it keeps them from arriving together.
 */
export const GRACE_MS = 15_000;

/**
 * How often the popup asks, given whether a clock is running. Here rather than
 * in the popup so the service worker can reason about the same cadence when it
 * decides how long to hold.
 */
export const POLL = { running: 2_000, idle: 30_000 } as const;

/**
 * The longest a single hold may be. A window can be hours, and sleeping
 * through all of it would miss a box that came back early — and the browser
 * measuring the wait may itself have been asleep. Checking back on this
 * cadence costs one refused request.
 */
export const MAX_HOLD_MS = 5 * 60_000;

const clamp = (ms: number): number => Math.min(Math.max(ms, GRACE_MS), MAX_HOLD_MS);

/**
 * When to ask again, given a window the pulse announced — or null to carry on
 * as usual.
 *
 * Nothing has changed until the window starts, so normal polling stands right
 * up until the next beat would land inside the outage; from then the wait runs
 * to its end. A window whose times cannot be read is no window at all: going
 * quiet on a half-understood announcement would silence the extension against
 * a server that is perfectly well.
 */
export function holdUntil(window: MaintenanceWindow | null | undefined, now: number, normalMs: number): number | null {
    if (!window) return null;

    const starts = Date.parse(window.starts_at);
    const ends = Date.parse(window.ends_at);

    if (!Number.isFinite(starts) || !Number.isFinite(ends)) return null;
    // Already over, or the next beat still lands before it begins.
    if (now >= ends || now + normalMs < starts) return null;

    return now + clamp(ends + GRACE_MS - now);
}

/**
 * When to ask again after the server refused a beat: as long as its
 * `Retry-After` asked for, or a default when it did not say.
 */
export function holdAfterRefusal(retryAfterSeconds: number | null, now: number, fallbackMs: number): number {
    return now + clamp(retryAfterSeconds === null ? fallbackMs : retryAfterSeconds * 1_000);
}

/** Is an outage still being waited out? */
export const isHeld = (downUntil: number | null | undefined, now: number): boolean => downUntil !== null && downUntil !== undefined && now < downUntil;
