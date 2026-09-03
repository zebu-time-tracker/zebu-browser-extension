// Service worker: the only piece that talks to Zebu. Keeps a short-lived
// cache of the running timer and the project list for the content scripts
// and the popup, opens the timer window for a page's issue, and shows a
// badge while a timer runs.
import { api, ApiError } from './api';
import { getMappings, getPendingIssue, getSettings, saveMappings, setPendingIssue } from './storage';
import { composeNotes, remember } from './suggest';
import type { Message, State } from './types';

const CACHE_MS = 5 * 60 * 1000;

let cache: State = { connected: false, running: null, projects: [], fetchedAt: 0 };

async function refresh(force = false): Promise<State> {
    const settings = await getSettings();
    if (!settings.workspace || !settings.token) {
        cache = { connected: false, running: null, projects: [], fetchedAt: Date.now() };
        await badge(null);
        return cache;
    }
    if (!force && Date.now() - cache.fetchedAt < CACHE_MS && cache.connected) return cache;

    try {
        const sheet = await api.timesheet();
        cache = { connected: true, running: sheet.running, projects: sheet.projects, fetchedAt: Date.now() };
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            cache = { connected: false, running: null, projects: [], fetchedAt: Date.now() };
        } else {
            // Network blip: keep what we had, but mark it stale so the next call retries.
            cache = { ...cache, fetchedAt: 0 };
        }
    }
    await badge(cache.running ? '●' : null);
    return cache;
}

async function badge(text: string | null): Promise<void> {
    await chrome.action.setBadgeText({ text: text ?? '' });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: '#197300' });
}

async function broadcast(state: State): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
        tabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, { type: 'state:changed', state }).catch(() => undefined) : undefined)),
    );
}

// One timer window at a time: its id is kept in session storage (no "tabs"
// permission needed to find it again) and reused if it is still open.
async function openTimerWindow(): Promise<void> {
    const url = chrome.runtime.getURL('popup.html?window=1');
    const { timerWindowId } = await chrome.storage.session.get('timerWindowId');
    if (typeof timerWindowId === 'number') {
        try {
            const existing = await chrome.windows.get(timerWindowId, { populate: true });
            await chrome.windows.update(existing.id!, { focused: true });
            const tab = existing.tabs?.[0];
            if (tab?.id) await chrome.tabs.update(tab.id, { url });
            return;
        } catch {
            // closed since
        }
    }
    const created = await chrome.windows.create({ url, type: 'popup', width: 440, height: 620, focused: true });
    await chrome.storage.session.set({ timerWindowId: created?.id });
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    (async () => {
        switch (message.type) {
            case 'state:get':
                return refresh();
            case 'state:refresh':
                return refresh(true);
            case 'issue:pending:get':
                return getPendingIssue();
            case 'issue:pending:clear':
                await setPendingIssue(null);
                return null;
            case 'timer:open':
                await setPendingIssue(message.issue);
                await openTimerWindow();
                return null;
            case 'timer:start': {
                const settings = await getSettings();
                const notes = message.notes || (message.issue ? composeNotes(message.issue, settings.noteFormat) : '');
                const { entry } = await api.startTimer({ project_id: message.projectId, task_id: message.taskId, notes });
                if (message.issue) {
                    await saveMappings(remember(await getMappings(), message.issue, message.projectId, message.taskId));
                }
                await setPendingIssue(null);
                const state = await refresh(true);
                await broadcast(state);
                return entry;
            }
            case 'timer:stop': {
                await api.stopTimer();
                const state = await refresh(true);
                await broadcast(state);
                return state;
            }
        }
    })().then(
        (result) => sendResponse({ ok: true, result }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), status: (error as ApiError)?.status }),
    );
    return true; // async response
});

// Keep the badge honest while timers are started/stopped elsewhere (web app, desktop).
chrome.alarms.create('refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refresh') void refresh(true).then(broadcast);
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') await chrome.runtime.openOptionsPage();
    await registerCustomSites();
});
chrome.runtime.onStartup.addListener(() => void refresh(true));

// Self-hosted trackers added on the options page get the same content script.
export async function registerCustomSites(): Promise<void> {
    const { customSites } = await getSettings();
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['zebu-custom'] }).catch(() => []);
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['zebu-custom'] });
    if (!customSites.length) return;
    await chrome.scripting.registerContentScripts([
        {
            id: 'zebu-custom',
            matches: customSites.map((s) => `${s.origin}/*`),
            js: ['content.js'],
            css: ['content.css'],
            runAt: 'document_idle',
        },
    ]);
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
        void registerCustomSites();
        void refresh(true).then(broadcast);
    }
});
