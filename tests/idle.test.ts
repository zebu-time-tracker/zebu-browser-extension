import {
    detectionInterval,
    IDLE_ACTION_ON_CLICK,
    IDLE_ACTION_ON_CLOSE,
    idleActionForButton,
    idleMinutes,
    idlePrefill,
    idlePrefillQuery,
    idlePrompt,
    onInput,
    promptStands,
    readIdlePrefill,
    REPORT_EVERY_MS,
    RETURN_GAP_MS,
    type IdleState,
} from '../src/idle';

const state = (patch: Partial<IdleState> = {}): IdleState => ({
    entry_id: '01K-A',
    timer_started_at: '2026-09-22T09:00:00+00:00',
    last_activity_at: '2026-09-22T11:20:00+00:00',
    idle_resolved_until: null,
    pending: true,
    idle_since: '2026-09-22T09:03:00+00:00',
    idle_until: '2026-09-22T11:03:00+00:00',
    idle_seconds: 7200,
    server_time: '2026-09-22T11:31:00+00:00',
    ...patch,
});

describe('seeing input (board #333)', () => {
    const now = Date.parse('2026-09-22T11:00:00Z');

    test('a first sighting — a fresh worker, a browser start — asks before reporting', () => {
        expect(onInput({}, now)).toEqual({ check: true, report: true });
    });

    test('input every minute neither asks nor reports more than once a minute', () => {
        expect(onInput({ activeAt: now - 60_000, sentAt: now - 60_000 }, now)).toEqual({ check: false, report: true });
        expect(onInput({ activeAt: now - 30_000, sentAt: now - 30_000 }, now)).toEqual({ check: false, report: false });
        expect(onInput({ activeAt: now - 1, sentAt: now - REPORT_EVERY_MS }, now).report).toBe(true);
    });

    test('a silence between alarm ticks (asleep, locked, Chrome closed) is a return', () => {
        expect(onInput({ activeAt: now - RETURN_GAP_MS, sentAt: now - RETURN_GAP_MS }, now).check).toBe(false);
        expect(onInput({ activeAt: now - RETURN_GAP_MS - 1, sentAt: now - RETURN_GAP_MS - 1 }, now).check).toBe(true);
        expect(onInput({ activeAt: now - 8 * 3600_000 }, now).check).toBe(true);
    });

    test("Chrome's own 'active' is a return however recent the last sighting", () => {
        expect(onInput({ activeAt: now - 30_000, sentAt: now - 30_000 }, now, true)).toEqual({ check: true, report: false });
    });
});

describe("the server's answer", () => {
    test('a pending gap at least as long as the threshold is asked about, with its minutes', () => {
        expect(idlePrompt(state(), 10)).toEqual({
            id: `zebu-idle-${Date.parse('2026-09-22T09:03:00Z')}`,
            entryId: '01K-A',
            timerStartedAt: '2026-09-22T09:00:00+00:00',
            since: '2026-09-22T09:03:00+00:00',
            minutes: 120,
        });
        expect(idlePrompt(state({ idle_seconds: 600 }), 10)?.minutes).toBe(10);
    });

    test('a night away is the whole night, not the last few minutes', () => {
        const night = state({ pending: false, idle_since: '2026-09-21T23:00:00+00:00', idle_until: null, idle_seconds: 9 * 3600 });
        expect(idlePrompt(night, 10)?.minutes).toBe(540);
    });

    test('shorter than this user asks about, nothing to ask, or nothing running: no prompt', () => {
        expect(idlePrompt(state({ idle_seconds: 599 }), 10)).toBeNull();
        expect(idlePrompt(state({ idle_since: null }), 10)).toBeNull();
        expect(idlePrompt(state({ entry_id: null, timer_started_at: null, idle_since: null, idle_until: null, pending: false, idle_seconds: 0 }), 10)).toBeNull();
        expect(idlePrompt(state({ idle_since: 'garbage' }), 10)).toBeNull();
    });

    test('the heading rounds to whole minutes and never says zero', () => {
        expect(idleMinutes(13 * 60 + 29)).toBe(13);
        expect(idleMinutes(13 * 60 + 31)).toBe(14);
        expect(idleMinutes(0)).toBe(1);
    });
});

describe('an open prompt after a change', () => {
    const prompt = idlePrompt(state(), 10)!;

    test('stands while the same timer runs and the same stretch is pending, however the instant is written', () => {
        expect(promptStands(prompt, state())).toBe(true);
        expect(promptStands(prompt, state({ idle_since: '2026-09-22T09:03:00Z', timer_started_at: '2026-09-22T11:00:00+02:00' }))).toBe(true);
    });

    test('goes when answered elsewhere, when the timer stopped, or when another one runs', () => {
        // answered elsewhere: the gap is gone and the live stretch starts at the answer
        expect(promptStands(prompt, state({ pending: false, idle_since: '2026-09-22T11:32:00+00:00', idle_until: null, idle_seconds: 5 }))).toBe(false);
        expect(promptStands(prompt, state({ entry_id: null, timer_started_at: null, idle_since: null }))).toBe(false);
        expect(promptStands(prompt, state({ entry_id: '01K-B' }))).toBe(false);
        // the same entry stopped and resumed
        expect(promptStands(prompt, state({ timer_started_at: '2026-09-22T11:30:00+00:00' }))).toBe(false);
    });
});

describe('the answers, in Harvest words', () => {
    test('first button continues and removes, second stops and removes, click adds a new entry, closing keeps', () => {
        expect(idleActionForButton(0)).toBe('discard_keep');
        expect(idleActionForButton(1)).toBe('discard_stop');
        expect(IDLE_ACTION_ON_CLICK).toBe('discard_new_entry');
        expect(IDLE_ACTION_ON_CLOSE).toBe('keep');
    });

    test('the removed stretch prefills the new-entry form on its own local day', () => {
        const prefill = idlePrefill({ started_at: '2026-09-22T09:03:00', ended_at: '2026-09-22T11:03:00', minutes: 120 });
        expect(prefill).toEqual({ date: '2026-09-22', minutes: 120 });
        expect(readIdlePrefill(`?${idlePrefillQuery(prefill!)}`)).toEqual(prefill);
        expect(new URLSearchParams(idlePrefillQuery(prefill!)).has('window')).toBe(true);
    });

    test('nothing to prefill from a broken span or a plain timer window', () => {
        expect(idlePrefill({ started_at: 'x', ended_at: 'x', minutes: 5 })).toBeNull();
        expect(idlePrefill({ started_at: '2026-09-22T09:03:00Z', ended_at: '2026-09-22T09:03:00Z', minutes: 0 })).toBeNull();
        expect(readIdlePrefill('?window=1')).toBeNull();
        expect(readIdlePrefill('?window=1&date=2026-09-22&minutes=-3')).toBeNull();
    });
});

test('the detection interval is the setting in seconds, floored at what Chrome accepts', () => {
    expect(detectionInterval(10)).toBe(600);
    expect(detectionInterval(0.1)).toBe(15);
});
