// Idle detection (board #269), now decided by the server (board #333).
//
// The extension used to keep "idle since" to itself in session storage, lost
// when Chrome quit — which is how a night away came back as ten minutes. The
// server now holds it for every device (web app PR 303): each client reports
// activity while a timer runs, and on coming back asks the server what to
// prompt about. What is left here is the decision logic, unit-tested: when a
// tick means "the person just came back", when to report, whether the
// server's answer is worth a prompt, whether an open prompt still stands, and
// what each part of the notification answers.

import { toDateString } from './dates';

/** GET /api/timer/idle. */
export interface IdleState {
    entry_id: string | null;
    timer_started_at: string | null;
    last_activity_at: string | null;
    idle_resolved_until: string | null;
    idle_since: string | null;
    idle_until: string | null;
    idle_seconds: number;
    pending: boolean;
    server_time?: string;
}

export type IdleAction = 'keep' | 'discard_keep' | 'discard_stop' | 'discard_new_entry';

/** The stretch an answer covered (POST /api/timer/idle `idle`). */
export interface IdleSpan {
    started_at: string;
    ended_at: string;
    minutes: number;
}

/** An idle prompt on screen: what the answer is about, kept so it survives the worker. */
export interface IdlePrompt {
    id: string;
    entryId: string;
    timerStartedAt: string | null;
    /** The server's `idle_since`, sent back as `idle_started_at`. */
    since: string;
    minutes: number;
}

/** The worker's own record of this machine's input: when it last saw some, and when it last told the server. */
export interface ActivityMarks {
    activeAt?: number;
    sentAt?: number;
}

/** The server takes a report at most once a minute. */
export const REPORT_EVERY_MS = 60_000;

/**
 * Input is checked on the once-a-minute alarm; a longer silence than this
 * between two sightings means the machine was idle, asleep, or Chrome was
 * closed, so the person has just come back.
 */
export const RETURN_GAP_MS = 3 * 60_000;

/**
 * What to do on seeing input: ask the server about the absence first
 * (`check`, always before any report, so the report cannot end the stretch
 * unasked), and whether to report. `returned` is Chrome saying "active" after
 * "idle" or "locked", which is a return however recent the last sighting.
 */
export const onInput = (marks: ActivityMarks, now: number, returned = false): { check: boolean; report: boolean } => ({
    check: returned || marks.activeAt === undefined || now - marks.activeAt > RETURN_GAP_MS,
    report: marks.sentAt === undefined || now - marks.sentAt >= REPORT_EVERY_MS,
});

/** Whole minutes away, as the prompt words it — an absence is never "0 minutes". */
export const idleMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/**
 * The prompt the server's answer calls for, or null. Asked only while a
 * timer runs, with a stretch to ask about, at least as long as this user's
 * own threshold (the server's gap is shorter and the same for everyone).
 */
export const idlePrompt = (state: IdleState, thresholdMinutes: number): IdlePrompt | null => {
    if (!state.entry_id || !state.idle_since) return null;
    if (state.idle_seconds < thresholdMinutes * 60) return null;
    const since = Date.parse(state.idle_since);
    if (Number.isNaN(since)) return null;
    return {
        id: `zebu-idle-${since}`,
        entryId: state.entry_id,
        timerStartedAt: state.timer_started_at,
        since: state.idle_since,
        minutes: idleMinutes(state.idle_seconds),
    };
};

const sameInstant = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

/**
 * Whether an open prompt still stands after something changed: not when
 * nothing runs, when another timer runs (or the same entry was restarted),
 * or when the stretch starts elsewhere — someone answered on another device.
 */
export const promptStands = (prompt: IdlePrompt, state: IdleState): boolean =>
    state.entry_id === prompt.entryId && sameInstant(state.timer_started_at, prompt.timerStartedAt) && sameInstant(state.idle_since, prompt.since);

/**
 * The notification's parts, as Harvest words them: the first button
 * continues timing and removes the time, the second stops and removes it,
 * clicking the notification itself adds the time as a new entry, and closing
 * it keeps the time (sent too, so the other devices stop asking).
 */
export const idleActionForButton = (index: number): 'discard_keep' | 'discard_stop' => (index === 1 ? 'discard_stop' : 'discard_keep');
export const IDLE_ACTION_ON_CLICK: IdleAction = 'discard_new_entry';
export const IDLE_ACTION_ON_CLOSE: IdleAction = 'keep';

/** Chrome accepts no interval under 15 seconds; the setting is in minutes. */
export const detectionInterval = (minutes: number): number => Math.max(15, Math.round(minutes * 60));

/** The new-entry form for a removed stretch: its local day and its minutes. */
export interface IdlePrefill {
    date: string;
    minutes: number;
}

export const idlePrefill = (span: IdleSpan): IdlePrefill | null => {
    const at = Date.parse(span.started_at);
    if (Number.isNaN(at) || !(span.minutes > 0)) return null;
    return { date: toDateString(new Date(at)), minutes: Math.round(span.minutes) };
};

/** The timer window's query for a prefilled new entry, and its reading back. */
export const idlePrefillQuery = (prefill: IdlePrefill): string => new URLSearchParams({ window: '1', date: prefill.date, minutes: String(prefill.minutes) }).toString();

export const readIdlePrefill = (search: string): IdlePrefill | null => {
    const params = new URLSearchParams(search);
    const date = params.get('date') ?? '';
    const minutes = Number(params.get('minutes'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(minutes) || minutes <= 0) return null;
    return { date, minutes };
};
