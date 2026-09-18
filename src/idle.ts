// Idle detection (board #269), Harvest-style, as the desktop menubar does it.
//
// Chrome reports the machine idle only after the detection interval has
// already passed without input, and active again on the first input. So the
// absence began an interval before the 'idle' event, and ends at 'active'.
// The question is then asked as a notification with the desktop's choices;
// the decision mapping and the arithmetic live here, unit-tested.

/** When the absence began: the interval before Chrome said "idle", never before the timer itself started. */
export const idleWindowStart = (firedAt: number, intervalSeconds: number, timerStartedAt: string | null): number | null => {
    const startedAt = firedAt - intervalSeconds * 1000;
    if (!timerStartedAt) return null;
    const timerAt = new Date(timerStartedAt).getTime();
    // a timer started during the absence (from the web, say) has no idle stretch worth asking about
    return startedAt >= timerAt ? startedAt : null;
};

/** Whole minutes away, as the heading words it — an absence is never "0 minutes". */
export const idleMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** The notification's two buttons: remove the time and keep timing, or remove it and stop. Dismissing keeps the time. */
export const idleActionForButton = (index: number): 'discard_keep' | 'discard_stop' => (index === 1 ? 'discard_stop' : 'discard_keep');

/** Chrome accepts no interval under 15 seconds; the setting is in minutes. */
export const detectionInterval = (minutes: number): number => Math.max(15, Math.round(minutes * 60));
