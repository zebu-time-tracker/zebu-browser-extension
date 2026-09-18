// Content script: figure out which issue the page is about, put a "Track
// time" button next to the tracker's own actions (or floating if the site's
// markup has moved), and keep its running/idle state in step with Zebu.
// Trackers are single-page apps, so the URL and title are watched rather
// than trusted once.
import { call as send, t } from '../messaging';
import { entryMatchesIssue } from '../suggest';
import type { Issue, State } from '../types';
import { ADAPTERS, adapterFor, type Adapter } from './adapters';

let adapter: Adapter | null = null;
let current: Issue | null = null;
let state: State | null = null;
let button: HTMLButtonElement | null = null;
let tickTimer: number | undefined;

async function resolveAdapter(): Promise<Adapter | null> {
    const { settings } = await chrome.storage.local.get('settings');
    return adapterFor(location.hostname, settings?.customSites ?? [], location.origin);
}

function elapsed(startedAt: string, minutes: number): string {
    const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) + minutes * 60;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render(): void {
    if (!button || !current) return;
    const running = state?.running && entryMatchesIssue(state.running.notes, current) ? state.running : null;
    const otherRunning = state?.running && !running;

    button.classList.toggle('zebu-track--running', !!running);
    button.classList.toggle('zebu-track--disabled', state !== null && !state.connected);

    const label = button.querySelector('.zebu-track__label')!;
    if (state && !state.connected) {
        label.textContent = t('button_connect');
        button.title = t('button_connect_title');
    } else if (running) {
        label.textContent = `${elapsed(running.timer_started_at!, running.minutes)} · ${t('button_stop')}`;
        button.title = t('button_stop_title', running.project ?? '');
    } else {
        label.textContent = otherRunning ? t('button_switch') : t('button_track');
        button.title = otherRunning ? t('button_switch_title', state!.running!.project ?? '') : t('button_track_title');
    }

    window.clearInterval(tickTimer);
    if (running) tickTimer = window.setInterval(render, 1000);
}

async function onClick(): Promise<void> {
    if (!current) return;
    if (state && !state.connected) {
        chrome.runtime.openOptionsPage?.() ?? send({ type: 'timer:open', issue: current });
        return;
    }
    const running = state?.running && entryMatchesIssue(state.running.notes, current);
    if (running) {
        await send({ type: 'timer:stop' });
        state = await send<State>({ type: 'state:get' });
        render();
        return;
    }
    await send({ type: 'timer:open', issue: current });
}

function mount(): void {
    if (!current || !adapter) return;
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'zebu-track';
        button.innerHTML = '<span class="zebu-track__dot" aria-hidden="true"></span><span class="zebu-track__label"></span>';
        button.addEventListener('click', onClick);
    }
    const anchor = adapter.anchor?.(document) ?? null;
    if (anchor) {
        button.classList.remove('zebu-track--floating');
        if (button.parentElement !== anchor) anchor.prepend(button);
    } else {
        button.classList.add('zebu-track--floating');
        if (button.parentElement !== document.body) document.body.appendChild(button);
    }
    render();
}

function unmount(): void {
    window.clearInterval(tickTimer);
    button?.remove();
    button = null;
}

let lastSignature = '';
async function scan(): Promise<void> {
    if (!adapter) return;
    const issue = adapter.detect(new URL(location.href), document);
    const signature = issue ? `${issue.key}|${issue.title}` : '';
    if (signature === lastSignature) {
        // Same issue; the anchor may have re-rendered underneath us.
        if (issue && button && !button.isConnected) mount();
        return;
    }
    lastSignature = signature;
    current = issue;
    if (!issue) {
        unmount();
        return;
    }
    mount();
    // Titles often load a beat after the URL changes; re-check shortly.
    window.setTimeout(scan, 1200);
}

async function refreshState(): Promise<void> {
    try {
        state = await send<State>({ type: 'state:get' });
    } catch {
        state = null;
    }
    render();
}

(async () => {
    adapter = await resolveAdapter();
    if (!adapter) return;

    await refreshState();
    await scan();

    // SPA navigation: poll the URL (cheap) and watch the title/body for changes.
    let href = location.href;
    window.setInterval(() => {
        if (location.href !== href) {
            href = location.href;
            void scan();
        }
    }, 500);
    new MutationObserver(() => {
        if (current) void scan();
    }).observe(document.querySelector('title') ?? document.documentElement, { childList: true, subtree: true, characterData: true });

    // The service worker broadcasts when the running timer changes elsewhere.
    chrome.runtime.onMessage.addListener((message: { type: string; state?: State }, _sender, sendResponse) => {
        if (message.type === 'state:changed' && message.state) {
            state = message.state;
            render();
        }
        // The popup and the context menu ask what this page is about, so a
        // tracker page keeps its adapter's identity when tracked from there.
        if (message.type === 'page:issue') sendResponse({ issue: current });
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refreshState();
    });
})();

export { ADAPTERS };
