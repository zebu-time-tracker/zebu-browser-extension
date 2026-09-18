// Thin client for the Zebu workspace API — the same endpoints the desktop
// app uses. The workspace base URL and the Sanctum token come from settings;
// requests only run from the service worker and the extension pages.
import { getSettings, saveSettings } from './storage';
import type { Entry, ProjectOption } from './types';

export interface Timesheet {
    week_start: string;
    entries: Entry[];
    running: Entry | null;
    projects: ProjectOption[];
    /** The pulse token this payload answers to; see `api.pulse()`. */
    pulse_token?: string;
    /** The server's clock at this response, for correcting the browser's. */
    server_time?: string;
}

/** "Has my active timer changed?" — a token and whether a clock is running. */
export interface Pulse {
    token: string;
    running: boolean;
    /**
     * An outage the server announced ahead of time. Present only while one is
     * announced and not yet over; never on a self-hosted workspace, which has
     * no operator to announce one (board #216).
     */
    maintenance?: MaintenanceWindow | null;
}

/** A planned outage. Both times are ISO 8601, as the server writes them. */
export interface MaintenanceWindow {
    starts_at: string;
    ends_at: string;
}

/**
 * The seconds a `Retry-After` header asks for, or null when it says nothing
 * usable — missing, junk, zero, or the HTTP-date form, which this server does
 * not send. Null means "unknown"; reading any of those as zero would mean
 * coming straight back at a box that is deliberately down.
 */
export const retryAfterSeconds = (header: string | null): number | null => {
    const seconds = Number(header);

    return header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        /**
         * On a 503, the server's own `Retry-After` in seconds — or null when
         * it did not send a usable one, which means "unknown", never "come
         * straight back".
         */
        public retryAfter: number | null = null,
    ) {
        super(message);
    }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const settings = await getSettings();
    if (!settings.workspace || !settings.token) throw new ApiError('not connected', 401);

    let response: Response;
    try {
        response = await fetch(`${settings.workspace}/api${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${settings.token}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError('unreachable', 0);
    }

    if (response.status === 401) {
        await saveSettings({ token: '', user: null });
        throw new ApiError('unauthenticated', 401);
    }
    // Deliberately down, not broken: kept apart so the caller waits as the
    // server asked rather than falling back to the expensive refetch, which
    // would be refused too (board #216).
    if (response.status === 503) {
        throw new ApiError('maintenance', 503, retryAfterSeconds(response.headers.get('Retry-After')));
    }
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new ApiError(data?.message ?? `request failed (${response.status})`, response.status);
    }
    return response.json() as Promise<T>;
}

const today = () => new Date().toISOString().slice(0, 10);

export const api = {
    deviceStart: async (workspace: string) => {
        const response = await fetch(`${workspace}/api/device/start`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_name: 'Zebu for Chrome' }),
        }).catch(() => {
            throw new ApiError('unreachable', 0);
        });
        if (!response.ok) throw new ApiError(`unreachable (${response.status})`, response.status);
        return response.json() as Promise<{ device_code: string; verification_url: string; interval: number; expires_in: number }>;
    },

    devicePoll: async (workspace: string, deviceCode: string) => {
        const response = await fetch(`${workspace}/api/device/poll`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: deviceCode }),
        });
        return { status: response.status, data: (await response.json().catch(() => ({}))) as { status?: string; token?: string } };
    },

    me: () => request<{ name: string; email: string }>('GET', '/me'),
    timesheet: () => request<Timesheet>('GET', `/timesheet?date=${today()}`),
    /**
     * One aggregate query and about forty bytes: the version of the answer to
     * "which timer is active". Polled instead of refetching the timesheet, so
     * a timer started elsewhere shows up in seconds rather than a minute.
     */
    pulse: () => request<Pulse>('GET', '/timer/pulse'),
    startTimer: (payload: { project_id: string; task_id?: string | null; notes?: string | null }) =>
        request<{ entry: Entry }>('POST', '/timer/start', payload),
    stopTimer: () => request<{ entry: Entry | null }>('POST', '/timer/stop', {}),
};
