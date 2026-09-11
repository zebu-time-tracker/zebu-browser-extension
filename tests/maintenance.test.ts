import { describe, expect, test } from 'vitest';

import { retryAfterSeconds } from '../src/api';
import { GRACE_MS, MAX_HOLD_MS, POLL, holdAfterRefusal, holdUntil, isHeld } from '../src/maintenance';

// Board #216. The server announces a planned outage on the timer pulse before
// it starts, then answers 503 with Retry-After for its duration. This
// extension polls that pulse several times a minute, so it is one of the
// clients that should stop asking rather than meet the outage a request at a
// time.

const WINDOW = { starts_at: '2026-09-11T21:00:00.000Z', ends_at: '2026-09-11T21:30:00.000Z' };
const at = (iso: string) => Date.parse(iso);

describe('an announced window', () => {
    test('changes nothing until it is nearly here', () => {
        expect(holdUntil(WINDOW, at('2026-09-11T20:30:00.000Z'), POLL.running)).toBeNull();
        expect(holdUntil(null, at('2026-09-11T21:15:00.000Z'), POLL.running)).toBeNull();
        expect(holdUntil(undefined, at('2026-09-11T21:15:00.000Z'), POLL.running)).toBeNull();
    });

    test('stops the beat that would land inside the outage', () => {
        // A second before it starts, the next running beat would arrive after
        // it had — so wait it out rather than ask a box that is going down.
        expect(holdUntil(WINDOW, at('2026-09-11T20:59:59.000Z'), POLL.running)).not.toBeNull();
    });

    test('holds to the end of the window, capped', () => {
        const now = at('2026-09-11T21:01:00.000Z');

        // 29 minutes left, so the cap applies rather than one long sleep.
        expect(holdUntil(WINDOW, now, POLL.running)).toBe(now + MAX_HOLD_MS);
    });

    test('holds exactly what is left near the end, plus the grace', () => {
        const now = at('2026-09-11T21:29:00.000Z');

        expect(holdUntil(WINDOW, now, POLL.running)).toBe(now + 60_000 + GRACE_MS);
    });

    test('holds nothing back once it is over', () => {
        expect(holdUntil(WINDOW, at('2026-09-11T21:30:00.000Z'), POLL.running)).toBeNull();
    });

    test('is ignored when its times cannot be read', () => {
        // Half-understanding an announcement and going quiet is worse than
        // ignoring it: the extension would stop asking a server that is fine.
        expect(holdUntil({ starts_at: 'soon', ends_at: 'later' }, at('2026-09-11T21:01:00.000Z'), POLL.running)).toBeNull();
    });
});

describe('a refusal', () => {
    test('waits as long as the server asked', () => {
        expect(holdAfterRefusal(90, 1_000, POLL.idle)).toBe(1_000 + 90_000);
    });

    test('still waits when the server said nothing usable, and never hammers', () => {
        expect(holdAfterRefusal(null, 0, POLL.idle)).toBe(POLL.idle);
        // Even "come straight back" gets the grace; an hour is capped.
        expect(holdAfterRefusal(0, 0, POLL.idle)).toBe(GRACE_MS);
        expect(holdAfterRefusal(3_600, 0, POLL.idle)).toBe(MAX_HOLD_MS);
    });
});

test('a hold is over the moment it expires', () => {
    expect(isHeld(null, 1_000)).toBe(false);
    expect(isHeld(undefined, 1_000)).toBe(false);
    expect(isHeld(2_000, 1_000)).toBe(true);
    expect(isHeld(1_000, 1_000)).toBe(false);
});

test('Retry-After is read only when it says something usable', () => {
    expect(retryAfterSeconds('900')).toBe(900);
    expect(retryAfterSeconds(' 30 ')).toBe(30);

    // Nothing usable is null — "unknown", which the caller turns into a wait.
    expect(retryAfterSeconds(null)).toBeNull();
    expect(retryAfterSeconds('')).toBeNull();
    expect(retryAfterSeconds('0')).toBeNull();
    expect(retryAfterSeconds('-5')).toBeNull();
    expect(retryAfterSeconds('soon')).toBeNull();
    // The header's other legal form, which this server does not send.
    expect(retryAfterSeconds('Fri, 11 Sep 2026 21:30:00 GMT')).toBeNull();
});
