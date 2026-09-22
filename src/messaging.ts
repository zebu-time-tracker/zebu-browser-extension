// Ask the service worker to do something. Every handler answers with
// { ok, result } or { ok, error, status }; this unwraps that into a value or
// a thrown Error carrying the HTTP status (0 = unreachable, 401 = not connected).
import type { Message } from './types';

export class CallError extends Error {
    constructor(
        message: string,
        public status: number | undefined,
    ) {
        super(message);
    }
}

export async function call<T>(message: Message): Promise<T> {
    const response = (await chrome.runtime.sendMessage(message)) as { ok: boolean; result?: T; error?: string; status?: number } | undefined;
    if (!response) throw new CallError('no response from the extension', undefined);
    if (!response.ok) throw new CallError(response.error ?? 'unknown error', response.status);
    return response.result as T;
}

export const t = (key: string, ...subs: string[]): string => chrome.i18n.getMessage(key, subs) || key;

/**
 * What to show someone when a call fails.
 *
 * Two of the three answers are ours, and one is the server's. A 402 is a plan
 * gate — the workspace has no seat free for this person — and the sentence it
 * comes with is written for the person reading it and names the owner to ask
 * (board #348). Wrapping that in "Something went wrong" would turn an answer
 * they can act on into an apology, so it is shown exactly as it came.
 */
export const errorText = (error: unknown): string => {
    if (error instanceof CallError && error.status === 0) return t('popup_error_unreachable');
    if (error instanceof CallError && error.status === 402 && error.message) return error.message;

    return t('popup_error_generic', error instanceof Error ? error.message : String(error));
};
