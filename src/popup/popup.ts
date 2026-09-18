// The timer UI. Opens two ways: from the toolbar icon (shows the running
// timer, or a blank start form) and as a small window from a page's "Track
// time" button (form prefilled with that issue, project suggested). Vanilla
// DOM on purpose — it's a few hundred lines and starts instantly.
import { call, CallError, t } from '../messaging';
import { pageIssue, withSelection } from '../page';
import { getMappings, getSettings } from '../storage';
import { composeNotes, entryMatchesIssue, suggest, type Suggestion } from '../suggest';
import type { Entry, Issue, ProjectOption, State } from '../types';
import { isHeld, POLL } from '../maintenance';

const app = document.getElementById('app')!;
const isWindow = new URLSearchParams(location.search).has('window');
if (isWindow) document.body.classList.add('window');

let state: State = { connected: false, running: null, projects: [], fetchedAt: 0, pulseToken: '', skewMs: 0, downUntil: null };
let issue: Issue | null = null;
// True when `issue` is only the page the toolbar popup was opened over: it
// prefills a new timer but does not force the form open over a running one.
let ambient = false;
let workspace = '';
let noteFormat: 'identifier_title_url' | 'title_url' | 'title' = 'identifier_title_url';
let recent: string[] = [];
let tick: number | undefined;
let watch: number | undefined;

/**
 * How often this page asks the service worker whether the timer changed. The
 * detached window stays open all day, so it used to sit there counting a timer
 * that had been stopped somewhere else hours before (board #49). Two seconds
 * while a clock is running, half a minute when none is — the question costs one
 * aggregate query and about forty bytes.
 */


const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
};

const elapsed = (entry: Entry): string => {
    // Against the server's clock: the start time came from the server, so a
    // browser running fast would otherwise show work nobody did.
    const now = Date.now() - state.skewMs;
    const secs = Math.max(0, Math.floor((now - new Date(entry.timer_started_at!).getTime()) / 1000)) + entry.minutes * 60;
    return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
};

const errorText = (error: unknown): string => {
    if (error instanceof CallError && error.status === 0) return t('popup_error_unreachable');
    return t('popup_error_generic', error instanceof Error ? error.message : String(error));
};

function header(): HTMLElement {
    const settings = el('a', { href: '#', text: t('popup_settings') });
    settings.addEventListener('click', (e) => {
        e.preventDefault();
        void chrome.runtime.openOptionsPage();
    });
    return el('div', { class: 'brand' }, [el('strong', { text: 'Zebu' }), settings]);
}

/**
 * The page under the toolbar popup: its title and link, and the selection,
 * read with the activeTab grant the click gave us. A tracker page answers
 * with its adapter's issue instead; pages that cannot be read (chrome://,
 * the store) give nothing.
 */
async function capturePage(): Promise<Issue | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (!tab?.id || !tab.url) return null;
    let selection = '';
    try {
        const [hit] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.getSelection()?.toString() ?? '' });
        selection = typeof hit?.result === 'string' ? hit.result : '';
    } catch {
        // not injectable
    }
    let known: Issue | null = null;
    try {
        known = ((await chrome.tabs.sendMessage(tab.id, { type: 'page:issue' })) as { issue?: Issue | null } | undefined)?.issue ?? null;
    } catch {
        // no content script here
    }
    return withSelection(known ?? pageIssue({ url: tab.url, title: tab.title ?? '', selection }), selection);
}

function renderNotConnected(): void {
    const button = el('button', { class: 'btn', text: t('popup_connect') });
    button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
    app.replaceChildren(header(), el('div', { class: 'card' }, [el('p', { text: t('popup_not_connected') }), button]));
}

function renderRunning(entry: Entry): void {
    window.clearInterval(tick);
    const time = el('div', { class: 'elapsed', text: elapsed(entry) });
    tick = window.setInterval(() => (time.textContent = elapsed(entry)), 1000);

    const startedAt = new Date(entry.timer_started_at!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const stop = el('button', { class: 'btn danger', text: t('popup_stop') });
    const error = el('p', { class: 'error' });
    stop.addEventListener('click', async () => {
        stop.disabled = true;
        try {
            state = await call<State>({ type: 'timer:stop' });
            render();
        } catch (e) {
            error.textContent = errorText(e);
            stop.disabled = false;
        }
    });
    const open = el('a', { class: 'btn secondary', href: `${workspace}/time`, target: '_blank', rel: 'noopener', text: t('popup_open_zebu') });
    const another = el('button', { class: 'btn secondary', text: t('popup_new_timer') });
    another.addEventListener('click', () => renderForm(true));

    app.replaceChildren(
        header(),
        el('div', { class: 'card running' }, [
            el('h2', { text: t('popup_running') }),
            time,
            el('div', { class: 'meta', text: [entry.project, entry.task].filter(Boolean).join(' · ') + ' — ' + t('popup_started', startedAt) }),
            entry.notes ? el('div', { class: 'notes', text: entry.notes }) : '',
            // agentic work: what the Claude Code hook measured on this timer
            entry.agent_waiting || (entry.waiting_minutes ?? 0) > 0
                ? el('div', { class: 'meta waiting', text: entry.agent_waiting && !(entry.waiting_minutes ?? 0) ? t('popup_waiting_now') : `⏳ ${t('popup_waiting', String(entry.waiting_minutes ?? 0))}${entry.agent_waiting ? ' …' : ''}` })
                : '',
            error,
            el('div', { class: 'row' }, [stop, open]),
            another,
        ]),
    );
}

async function renderForm(force = false): Promise<void> {
    window.clearInterval(tick);
    const mappings = await getMappings();
    const ranked = suggest(issue, state.projects, mappings, recent);
    const suggested = ranked.filter((s) => s.reason !== 'recent' && s.score >= 0.45).slice(0, 4);

    let selected: Suggestion | null = suggested[0] ?? null;
    let filter = '';

    const search = el('input', { type: 'search', placeholder: t('popup_project_search'), autocomplete: 'off' }) as HTMLInputElement;
    const list = el('div', { class: 'projects', role: 'listbox' });
    const taskSelect = el('select') as HTMLSelectElement;
    const notes = el('textarea') as HTMLTextAreaElement;
    notes.value = issue ? composeNotes(issue, noteFormat) : '';
    const error = el('p', { class: 'error' });
    const start = el('button', { class: 'btn', text: t('popup_start') }) as HTMLButtonElement;

    const renderTasks = () => {
        taskSelect.replaceChildren(el('option', { value: '', text: t('popup_task_none') }));
        for (const task of selected?.project.tasks ?? []) taskSelect.append(el('option', { value: task.id, text: task.name }));
        taskSelect.value = selected?.taskId ?? '';
        taskSelect.disabled = !selected || selected.project.tasks.length === 0;
        start.disabled = !selected;
    };

    const option = (s: Suggestion, badge?: string) => {
        const button = el('button', { type: 'button', role: 'option', 'aria-selected': String(selected?.project.id === s.project.id) }, [
            el('span', {}, [s.project.name, badge ? ' ' : '', badge ? el('span', { class: 'pill', text: badge }) : '']),
            el('span', { class: 'client', text: s.project.client ?? '' }),
        ]);
        button.addEventListener('click', () => {
            selected = s;
            renderList();
            renderTasks();
        });
        return button;
    };

    const renderList = () => {
        list.replaceChildren();
        const q = filter.trim().toLowerCase();
        const matches = (p: ProjectOption) => !q || `${p.client ?? ''} ${p.name}`.toLowerCase().includes(q);
        if (!q && suggested.length) {
            list.append(el('div', { class: 'group', text: t('popup_suggested') }));
            for (const s of suggested) list.append(option(s, s.reason === 'remembered' ? t('popup_remembered') : undefined));
            list.append(el('div', { class: 'group', text: t('popup_all_projects') }));
        }
        const rest = ranked.filter((s) => matches(s.project) && (q || !suggested.includes(s)));
        for (const s of rest) list.append(option(s));
        if (!rest.length && !(!q && suggested.length)) list.append(el('div', { class: 'empty', text: t('popup_no_projects') }));
    };
    search.addEventListener('input', () => {
        filter = search.value;
        renderList();
    });

    start.addEventListener('click', async () => {
        if (!selected) return;
        start.disabled = true;
        start.textContent = t('popup_starting');
        try {
            await call<Entry>({ type: 'timer:start', issue, projectId: selected.project.id, taskId: taskSelect.value || null, notes: notes.value });
            if (isWindow) {
                window.close();
                return;
            }
            issue = null;
            state = await call<State>({ type: 'state:get' });
            render();
        } catch (e) {
            error.textContent = errorText(e);
            start.disabled = false;
            start.textContent = t('popup_start');
        }
    });

    renderList();
    renderTasks();

    const card = el('div', { class: 'card' }, [
        el('h2', { text: issue ? t(issue.site === 'page' ? 'popup_for_page' : 'popup_for_issue') : t('popup_new_timer') }),
        issue
            ? el('div', { class: 'issue' }, [
                  issue.identifier ? el('span', { class: 'id', text: issue.identifier }) : '',
                  el('span', { class: 'title', text: issue.title }),
                  el('span', { class: 'where', text: issue.container }),
              ])
            : '',
        el('label', { text: t('popup_project') }),
        search,
        list,
        el('label', { text: t('popup_task') }),
        taskSelect,
        el('label', { text: t('popup_notes') }),
        notes,
        state.running && !force ? el('p', { class: 'notice', text: t('popup_switch_note', state.running.project ?? '') }) : state.running ? el('p', { class: 'notice', text: t('popup_switch_note', state.running.project ?? '') }) : '',
        error,
        start,
    ]);
    app.replaceChildren(header(), card);
    if (!selected) search.focus();
}

/**
 * Re-ask the service worker whether the timer changed, and redraw when it did.
 * Rescheduled after each answer rather than on a fixed interval, so a slow
 * reply cannot stack requests, and paused while the window is hidden.
 */
function watchTimer(): void {
    window.clearTimeout(watch);
    if (document.hidden) return;

    watch = window.setTimeout(async () => {
        try {
            const next = await call<State>({ type: 'state:pulse' });
            const changed = next.running?.id !== state.running?.id || next.running?.timer_started_at !== state.running?.timer_started_at;
            state = next;
            // Only redraw on a real change: the form holds what the user is
            // half way through typing, and the running card has its own ticker.
            if (changed) render();
            else watchTimer();
        } catch {
            watchTimer();
        }
    }, nextWatchIn(state, Date.now()));
}

/**
 * How long until the next ask. While an announced outage is being waited out,
 * that is what is left of the hold rather than the running cadence — the
 * service worker will not ask the server either way, so polling it every two
 * seconds only spins this window (board #216).
 */
export function nextWatchIn(state: Pick<State, 'running' | 'downUntil'>, now: number): number {
    if (isHeld(state.downUntil, now)) return Math.max(state.downUntil! - now, POLL.idle);

    return state.running ? POLL.running : POLL.idle;
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) watchTimer();
    else window.clearTimeout(watch);
});

function render(): void {
    watchTimer();
    if (!state.connected) return renderNotConnected();
    // A page handed us an issue: go straight to the form, unless this very
    // issue is what's already running (then show it so it can be stopped).
    if (issue && !ambient && !(state.running && entryMatchesIssue(state.running.notes, issue))) return void renderForm();
    if (state.running) return renderRunning(state.running);
    void renderForm();
}

(async () => {
    const settings = await getSettings();
    workspace = settings.workspace;
    noteFormat = settings.noteFormat;
    try {
        state = await call<State>({ type: 'state:get' });
        issue = await call<Issue | null>({ type: 'issue:pending:get' });
        if (!isWindow) {
            // The toolbar popup is handed no issue, but it has the page it was
            // opened over: title, link and selection prefill a new timer.
            issue = await capturePage();
            ambient = true;
        }
        const mappings = await getMappings();
        recent = Object.values(mappings)
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .map((m) => m.projectId)
            .filter((id, i, arr) => arr.indexOf(id) === i)
            .slice(0, 8);
    } catch (e) {
        app.replaceChildren(header(), el('div', { class: 'card' }, [el('p', { class: 'error', text: errorText(e) })]));
        return;
    }
    render();
})();
