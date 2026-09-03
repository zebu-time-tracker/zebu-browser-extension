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
