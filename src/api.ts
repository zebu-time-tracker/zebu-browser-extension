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
}

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message);
    }
}

/**
 * Normalise what a user types as their workspace into a base URL:
 * "studio" → https://studio.app.zebu.work, "studio.app.zebu.work" → https://…,
 * a full URL (dev servers included) is kept as-is minus trailing slashes.
 */
export function workspaceUrl(input: string, defaultDomain = 'app.zebu.work'): string {
    let value = input.trim().replace(/\/+$/, '');
    if (value === '') return '';
    if (!/^https?:\/\//i.test(value)) {
        value = value.includes('.') ? `https://${value}` : `https://${value}.${defaultDomain}`;
    }
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return '';
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
    startTimer: (payload: { project_id: string; task_id?: string | null; notes?: string | null }) =>
        request<{ entry: Entry }>('POST', '/timer/start', payload),
    stopTimer: () => request<{ entry: Entry | null }>('POST', '/timer/stop', {}),
};
