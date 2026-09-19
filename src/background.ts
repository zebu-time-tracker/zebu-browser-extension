// Service worker: the only piece that talks to Zebu. Keeps a short-lived
// cache of the running timer and the project list for the content scripts
// and the popup, opens the timer window for a page's issue, and shows a
// clock in the toolbar icon while a timer runs.
import { api, ApiError } from './api';
import { inWeek, toDateString } from './dates';
import { elapsedMinutes, formatDurationHuman, formatMinutes } from './duration';
import { CLOCK_GREEN, clockImages, idleImages } from './icon';
import { detectionInterval, idleActionForButton, idleMinutes, idleWindowStart } from './idle';
import { lastTimerFor, lastTimerFrom } from './lastTimer';
import { backoffMs, KEEPALIVE_MS, parseFrame, PING, PONG, readBroadcast, shouldRefetch, socketIdOf, socketUrl, subscribeFrame, timerChangedOf } from './live';
import { holdAfterRefusal, holdUntil, isHeld, POLL } from './maintenance';
import { t } from './messaging';
import { pageIssue, withSelection } from './page';
import { getLastTimer, getMappings, getPendingIssue, getSettings, saveMappings, saveSettings, setLastTimer, setPendingIssue } from './storage';
import { composeNotes, remember } from './suggest';
import type { Entry, Issue, Message, State, WeekSheet } from './types';

/**
 * How long a cached timesheet is served without asking again. It used to be
 * five minutes, which meant a timer stopped on the web could still be ticking
 * in the popup long after (board #49). Freshness now comes from the pulse —
 * this is only the floor that stops a burst of messages refetching — so it can
 * be short without costing anything.
 */
const CACHE_MS = 15 * 1000;

const empty = (): State => ({ connected: false, running: null, projects: [], entries: [], weekStart: '', weekLocked: false, projectStats: {}, fetchedAt: Date.now(), pulseToken: '', skewMs: 0, downUntil: null, live: false });

let cache: State = { ...empty(), fetchedAt: 0 };

export async function refresh(force = false): Promise<State> {
    const settings = await getSettings();
    if (!settings.workspace || !settings.token) {
        cache = empty();
        await badge(null);
        return cache;
    }
    if (!force && Date.now() - cache.fetchedAt < CACHE_MS && cache.connected) return cache;

    try {
        const sheet = await api.timesheet();
        cache = {
            connected: true,
            running: sheet.running,
            projects: sheet.projects,
            entries: sheet.entries,
            weekStart: sheet.week_start,
            weekLocked: sheet.week_locked,
            projectStats: sheet.project_stats ?? {},
            fetchedAt: Date.now(),
            pulseToken: sheet.pulse_token ?? '',
            // Measured the moment the reply lands, so the round trip is not
            // counted as drift. Only a real difference survives.
            skewMs: sheet.server_time ? Date.now() - new Date(sheet.server_time).getTime() : 0,
            // The server answered, so whatever hold was in force is over.
            downUntil: null,
            live: cache.live,
        };
        // The server's own "current timer" is what Resume offers (board #268):
        // the running one, else the entry touched last. Older workspaces do
        // not send `active`; the running entry is the next best answer.
        const current = sheet.active ?? sheet.running;
        if (current) await setLastTimer(lastTimerFrom(current, settings.workspace));
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            cache = empty();
        } else {
            // Network blip: keep what we had, but mark it stale so the next call retries.
            cache = { ...cache, fetchedAt: 0 };
        }
    }
    await badge(cache.running);
    return cache;
}

/**
 * Ask only whether anything changed, and refetch when it did. This is what an
 * open popup or the detached timer window polls: the cheap question, several
 * times a minute, instead of the whole timesheet once a minute.
 *
 * A pulse that cannot be answered falls through to a full refresh rather than
 * leaving the caller with a stopped clock still ticking.
 */
export async function pulse(): Promise<State> {
    const settings = await getSettings();
    if (!settings.workspace || !settings.token) return refresh();

    // Down for the announced window: do not ask, and above all do not fall
    // through to the refetch — the timesheet is refused too, and asking for it
    // is the hammering Retry-After exists to stop (board #216).
    if (isHeld(cache.downUntil, Date.now())) return cache;

    if (!cache.connected || !cache.pulseToken) return refresh(true);

    try {
        const { token, maintenance } = await api.pulse();
        cache = { ...cache, downUntil: holdUntil(maintenance, Date.now(), POLL.running) };
        if (token === cache.pulseToken) {
            await badge(cache.running);
            return cache;
        }
    } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
            cache = { ...cache, downUntil: holdAfterRefusal(e.retryAfter, Date.now(), POLL.idle) };
            return cache;
        }
        // No pulse (old workspace, network blip): fall back to the refetch.
    }
    return refresh(true);
}

/**
 * The week holding `date`, for the popup's day list (board #267). The current
 * week is what the cache already holds; any other week is fetched and not
 * kept — the cache is the week the badge and the pulse are about.
 */
export async function weekSheet(date: string): Promise<WeekSheet> {
    const state = await refresh();
    if (!state.connected) return { entries: [], weekStart: '', weekLocked: false, projectStats: {} };
    if (inWeek(date, state.weekStart)) return { entries: state.entries, weekStart: state.weekStart, weekLocked: state.weekLocked, projectStats: state.projectStats };
    const sheet = await api.timesheet(date);
    return { entries: sheet.entries, weekStart: sheet.week_start, weekLocked: sheet.week_locked, projectStats: sheet.project_stats ?? {} };
}

/** After a change on the server: refetch, and tell every page. */
async function changed(): Promise<State> {
    const state = await refresh(true);
    await broadcast(state);
    return state;
}

const DEFAULT_ICON = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };
/** What the icon last showed, so a pulse every two seconds redraws nothing; 'unset' so the first call always applies. */
let shownClock = 'unset';

/**
 * The toolbar icon is the running timer's clock (board #268): hours over
 * minutes, drawn into the green square, as the menubar pill shows it. Nothing
 * running: the Z in a green outline, so a filled square always means a timer.
 * The badge and the shipped icon are the fallbacks where the worker cannot draw.
 */
async function badge(running: Entry | null): Promise<void> {
    const minutes = running ? Math.round(elapsedMinutes(running, Date.now() - cache.skewMs)) : null;
    const key = running ? `${running.id}:${minutes}` : '';
    if (key === shownClock) return;
    shownClock = key;
    if (!running || minutes === null) {
        const idle = idleImages();
        await chrome.action.setIcon(idle ? { imageData: idle } : { path: DEFAULT_ICON });
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setTitle({ title: 'Zebu' });
        return;
    }
    const images = clockImages(minutes);
    if (images) {
        await chrome.action.setIcon({ imageData: images });
        await chrome.action.setBadgeText({ text: '' });
    } else {
        await chrome.action.setBadgeText({ text: formatMinutes(minutes) });
        await chrome.action.setBadgeBackgroundColor({ color: CLOCK_GREEN });
    }
    await chrome.action.setTitle({ title: `${[running.project, running.task].filter(Boolean).join(' · ') || 'Zebu'} · ${formatMinutes(minutes)}` });
}

/**
 * Resume the last timer (board #268). Today's entry is resumed as itself; an
 * older one starts a fresh timer today with the same project, task and notes,
 * never back-dated onto the old day. Nothing remembered: nothing happens.
 */
export async function resumeLast(): Promise<State> {
    const settings = await getSettings();
    const last = lastTimerFor(await getLastTimer(), settings.workspace);
    if (!last) return refresh();
    if (last.date === toDateString(new Date())) await api.startTimer({ project_id: last.project_id, entry_id: last.entry_id });
    else await api.startTimer({ project_id: last.project_id, task_id: last.task_id, notes: last.notes });
    return changed();
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

// Any page can be tracked from the right-click menu: the page itself, or a
// selection that becomes the timer's description (board #266). Chrome fills
// %s in the selection entry's title with the selected text.
async function installContextMenus(): Promise<void> {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'zebu-page', title: t('context_track_page'), contexts: ['page'] });
    chrome.contextMenus.create({ id: 'zebu-selection', title: t('context_track_selection'), contexts: ['selection'] });
}

/** What a tab's content script says the page is, when there is one (tracker pages); null elsewhere. */
async function issueFromTab(tabId: number): Promise<Issue | null> {
    try {
        const reply = (await chrome.tabs.sendMessage(tabId, { type: 'page:issue' })) as { issue?: Issue | null } | undefined;
        return reply?.issue ?? null;
    } catch {
        return null; // no content script on this page
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    void (async () => {
        const url = info.pageUrl ?? tab?.url ?? '';
        const known = tab?.id ? await issueFromTab(tab.id) : null;
        const issue = withSelection(known ?? pageIssue({ url, title: tab?.title ?? '', selection: info.selectionText }), info.selectionText);
        if (!issue) return;
        await setPendingIssue(issue);
        await openTimerWindow();
    })();
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    (async () => {
        switch (message.type) {
            case 'state:get':
                return refresh();
            case 'state:refresh':
                return refresh(true);
            case 'state:pulse':
                return pulse();
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
                return changed();
            }
            case 'sheet:get':
                return weekSheet(message.date);
            case 'timer:resume': {
                await api.startTimer({ project_id: message.projectId, entry_id: message.entryId });
                return changed();
            }
            case 'timer:resume-last':
                return resumeLast();
            case 'summary:get':
                return api.summary();
            case 'entry:add': {
                const settings = await getSettings();
                const notes = message.notes || (message.issue ? composeNotes(message.issue, settings.noteFormat) : '');
                const { entry } = await api.addEntry({ project_id: message.projectId, task_id: message.taskId, date: message.date, minutes: message.minutes, notes });
                if (message.issue) {
                    await saveMappings(remember(await getMappings(), message.issue, message.projectId, message.taskId));
                }
                await setPendingIssue(null);
                await changed();
                return entry;
            }
            case 'entry:update': {
                const { entry } = await api.updateEntry(message.id, {
                    project_id: message.projectId,
                    task_id: message.taskId,
                    notes: message.notes,
                    date: message.date,
                    // null means the duration was not touched: leave a running clock alone
                    ...(message.minutes === null ? {} : { minutes: message.minutes }),
                });
                await changed();
                return entry;
            }
            case 'entry:delete': {
                await api.deleteEntry(message.id);
                return changed();
            }
        }
    })().then(
        (result) => sendResponse({ ok: true, result }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), status: (error as ApiError)?.status }),
    );
    return true; // async response
});

// Keep the badge honest while timers are started/stopped elsewhere (web app,
// desktop). A minute is the floor MV3 allows an alarm, and it is only the
// backstop for the badge; anything looking at a timer polls the pulse instead.
//
// Created once, not on every service-worker start: the worker wakes for every
// message and every alarm, and re-creating an alarm resets its schedule, so
// the old unconditional call could push the next fire away indefinitely on a
// busy browser.
export async function ensureRefreshAlarm(): Promise<void> {
    if (await chrome.alarms.get('refresh')) return;
    await chrome.alarms.create('refresh', { periodInMinutes: 1 });
}
void ensureRefreshAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refresh') {
        void refresh(true).then(broadcast);
        void relearnBroadcast().then(connectLive);
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') await chrome.runtime.openOptionsPage();
    await registerCustomSites();
    await installContextMenus();
    await applyIdleSettings();
});
chrome.runtime.onStartup.addListener(() => {
    void refresh(true);
    void applyIdleSettings();
});

// ---- idle detection (board #269) -------------------------------------------
//
// Chrome watches the machine's input for us (chrome.idle) and says "idle"
// once the detection interval has passed without any, then "active" on the
// first keypress or click. The absence therefore began an interval before the
// first event; it is noted in session storage (the worker may be gone by the
// time the user is back) and asked about as a notification on return, with
// the desktop's choices: remove the time and keep timing, remove it and stop,
// or dismiss to keep it. The server does the arithmetic on `idle_started_at`.

/** Session storage: when the absence in progress began (epoch ms). */
const IDLE_SINCE = 'idleSince';

export async function applyIdleSettings(): Promise<void> {
    const { idleMinutes: minutes } = await getSettings();
    chrome.idle.setDetectionInterval(detectionInterval(minutes));
}

async function onIdleState(state: chrome.idle.IdleState): Promise<void> {
    const settings = await getSettings();
    if (!settings.idleEnabled) return;
    if (state === 'active') {
        const { [IDLE_SINCE]: since } = await chrome.storage.session.get(IDLE_SINCE);
        await chrome.storage.session.remove(IDLE_SINCE);
        if (typeof since !== 'number') return;
        const state = await refresh(true);
        if (!state.running) return;
        await askAboutIdle(since, (Date.now() - since) / 1000, state.running);
        return;
    }
    // idle or locked: an absence begins, unless one is already in progress (idle → locked)
    const { [IDLE_SINCE]: since } = await chrome.storage.session.get(IDLE_SINCE);
    if (typeof since === 'number') return;
    const current = await refresh();
    if (!current.running) return;
    const startedAt = idleWindowStart(Date.now(), detectionInterval(settings.idleMinutes), current.running.timer_started_at);
    if (startedAt !== null) await chrome.storage.session.set({ [IDLE_SINCE]: startedAt });
}

async function askAboutIdle(startedAt: number, seconds: number, running: Entry): Promise<void> {
    const id = `zebu-idle-${startedAt}`;
    await chrome.storage.session.set({ [`idle:${id}`]: startedAt });
    const units = { hour: t('unit_hour'), minute: t('unit_minute'), day: t('unit_day'), week: t('unit_week') };
    await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: t('idle_title', formatDurationHuman(idleMinutes(seconds), units)),
        message: t('idle_message', running.project ?? ''),
        contextMessage: t('idle_keep'),
        buttons: [{ title: t('idle_remove') }, { title: t('idle_remove_stop') }],
        requireInteraction: true,
        priority: 2,
    });
}

chrome.idle.onStateChanged.addListener((state) => void onIdleState(state));

chrome.notifications.onButtonClicked.addListener((id, index) => {
    void (async () => {
        const key = `idle:${id}`;
        const { [key]: startedAt } = await chrome.storage.session.get(key);
        await chrome.storage.session.remove(key);
        chrome.notifications.clear(id);
        if (typeof startedAt !== 'number') return;
        await api.idleTimer({ idle_started_at: new Date(startedAt).toISOString(), action: idleActionForButton(index) });
        await changed();
    })();
});
// dismissed, or clicked without choosing: the time stays
chrome.notifications.onClosed.addListener((id) => void chrome.storage.session.remove(`idle:${id}`));
chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

// Keyboard shortcuts (manifest `commands`, rebindable at
// chrome://extensions/shortcuts). The popup itself is `_execute_action`,
// which Chrome opens without asking us. A shortcut press grants activeTab, so
// the page under the cursor can be read for a new timer.
chrome.commands.onCommand.addListener((command, tab) => {
    void (async () => {
        if (command === 'toggle-timer') {
            const state = await refresh();
            if (!state.connected) return chrome.runtime.openOptionsPage();
            if (state.running) {
                await api.stopTimer();
                await changed();
                return;
            }
            const last = lastTimerFor(await getLastTimer(), (await getSettings()).workspace);
            if (last) await resumeLast();
            else await openTimerWindow();
        } else if (command === 'new-timer') {
            const known = tab?.id ? await issueFromTab(tab.id) : null;
            await setPendingIssue(known ?? (tab?.url ? pageIssue({ url: tab.url, title: tab.title ?? '' }) : null));
            await openTimerWindow();
        }
    })();
});

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
        void applyIdleSettings();
        void refresh(true).then(broadcast);
        void connectLive();
    }
});

// ---- live updates over Reverb (board #279) ------------------------------------
//
// The workspace pushes "your timer changed" over a websocket (Pusher protocol,
// see src/live.ts); on one the cache is refetched exactly as after a pulse
// that moved, and every page and popup is told. The socket lives here, in the
// service worker, so the badge and the page buttons are live too; a ping every
// twenty seconds keeps the worker alive (Chrome 116+), and when it is killed
// anyway the next start — every message, every alarm — reconnects. Without a
// `broadcast` block from the server nothing here runs and the pulse stays as
// it is.

let socket: WebSocket | null = null;
/** What the open socket was built for; a new target replaces it. */
let liveTarget = '';
let liveAttempt = 0;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let keepalive: ReturnType<typeof setInterval> | undefined;
/** True once a socket has dropped: the next subscription refetches, since anything could have happened meanwhile. */
let liveGap = false;

async function setLive(live: boolean): Promise<void> {
    if (cache.live === live) return;
    cache = { ...cache, live };
    await broadcast(cache);
}

function closeLive(): void {
    clearTimeout(liveTimer);
    clearInterval(keepalive);
    keepalive = undefined;
    if (socket) {
        const s = socket;
        socket = null;
        s.onclose = null;
        s.onerror = null;
        s.onmessage = null;
        s.close();
    }
}

/**
 * The broadcast block is learned at login, but a workspace can switch Reverb
 * on (or off, or rotate its key) long after: while nothing is subscribed, ask
 * GET /api/me again every few minutes and save what changed — the storage
 * listener then opens or closes the socket. Nothing is asked while live.
 */
export const RELEARN_MS = 5 * 60_000;
let relearnedAt = 0;

export async function relearnBroadcast(now = Date.now()): Promise<void> {
    if (cache.live || now - relearnedAt < RELEARN_MS) return;
    const settings = await getSettings();
    if (!settings.workspace || !settings.token) return;
    relearnedAt = now;
    let learned: unknown;
    try {
        learned = (await api.me()).broadcast;
    } catch {
        return; // unreachable or revoked: the pulse path already reports that
    }
    const next = readBroadcast(learned);
    if (JSON.stringify(next) !== JSON.stringify(readBroadcast(settings.broadcast))) await saveSettings({ broadcast: next });
}

/** Open (or keep) the socket the settings describe; close it when they no longer describe one. */
export async function connectLive(): Promise<void> {
    if (typeof WebSocket === 'undefined') return;
    const settings = await getSettings();
    const config = settings.workspace && settings.token ? readBroadcast(settings.broadcast) : null;
    if (!config) {
        closeLive();
        liveTarget = '';
        await setLive(false);
        return;
    }
    const url = socketUrl(config, settings.workspace, chrome.runtime.getManifest().version);
    const target = `${url}|${config.channel}`;
    if (socket && liveTarget === target && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    closeLive();
    liveTarget = target;
    const s = new WebSocket(url);
    socket = s;
    s.onmessage = (e) => void onLiveFrame(s, config.channel, e.data);
    s.onclose = () => void onLiveClosed(s);
    s.onerror = () => s.close();
}

async function onLiveFrame(s: WebSocket, channel: string, raw: unknown): Promise<void> {
    if (s !== socket) return;
    const frame = parseFrame(raw);
    if (!frame) return;
    const socketId = socketIdOf(frame);
    if (socketId) {
        try {
            const { auth } = await api.broadcastingAuth(socketId, `private-${channel}`);
            if (s === socket) s.send(subscribeFrame(channel, auth));
        } catch {
            s.close(); // reconnects with backoff; a 401 also cleared the token, so the next attempt stops
        }
        return;
    }
    if (frame.event === 'pusher_internal:subscription_succeeded') {
        liveAttempt = 0;
        clearInterval(keepalive);
        keepalive = setInterval(() => {
            if (s === socket && s.readyState === WebSocket.OPEN) s.send(PING);
        }, KEEPALIVE_MS);
        await setLive(true);
        if (liveGap) {
            liveGap = false;
            await changed();
        }
        return;
    }
    if (frame.event === 'pusher:ping') {
        s.send(PONG);
        return;
    }
    if (frame.event === 'pusher:error') {
        s.close();
        return;
    }
    const event = timerChangedOf(frame);
    if (!event) return;
    // The server's clock rode along: the freshest reading there is.
    if (event.at) {
        const at = new Date(event.at).getTime();
        if (!Number.isNaN(at)) cache = { ...cache, skewMs: Date.now() - at };
    }
    if (shouldRefetch(event.token, cache.pulseToken)) await changed();
}

async function onLiveClosed(s: WebSocket): Promise<void> {
    if (s !== socket) return;
    socket = null;
    clearInterval(keepalive);
    keepalive = undefined;
    liveGap = true;
    await setLive(false);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void connectLive(), backoffMs(liveAttempt++));
}

// Every worker start is a chance the socket died with the last one.
void connectLive();
