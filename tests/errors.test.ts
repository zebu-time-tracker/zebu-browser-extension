import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CallError, errorText } from '../src/messaging';

// Board #348. A workspace that drops to a plan with fewer seats than it has
// people answers 402 to the clients of whoever is over the line, with a
// sentence naming the owner to ask. That sentence is the useful part, and
// "Something went wrong: …" in front of it would bury it.

beforeEach(() => {
    // chrome.i18n, enough of it: the key and its substitutions, visibly.
    vi.stubGlobal('chrome', {
        i18n: { getMessage: (key: string, subs: string[] = []) => (subs.length ? `${key}(${subs.join(',')})` : key) },
    });
});

const SEATS = 'No seats available. Please ask the workspace owner at owner@team.test to upgrade to Pro.';

describe('what a failed call says', () => {
    test('a plan gate speaks for itself', () => {
        expect(errorText(new CallError(SEATS, 402))).toBe(SEATS);
    });

    test('an unreachable server is ours to phrase', () => {
        expect(errorText(new CallError('unreachable', 0))).toBe('popup_error_unreachable');
    });

    test('anything else is wrapped, so it reads as a fault rather than an answer', () => {
        expect(errorText(new CallError('boom', 500))).toBe('popup_error_generic(boom)');
        expect(errorText(new Error('boom'))).toBe('popup_error_generic(boom)');
        expect(errorText('boom')).toBe('popup_error_generic(boom)');
    });

    test('a 402 with nothing to say falls back rather than showing an empty line', () => {
        expect(errorText(new CallError('', 402))).toBe('popup_error_generic()');
    });
});
