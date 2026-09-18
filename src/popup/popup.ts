// The timer UI. Opens two ways: from the toolbar icon (the running timer, the
// day's entries, and a form to start or log one — board #267) and as a small
// window from a page's "Track time" button (form prefilled with that issue,
// project suggested). Vanilla DOM on purpose — it's a few hundred lines and
// starts instantly.
import { shiftDate, toDateString } from '../dates';
import { elapsedMinutes, formatDurationHuman, formatMinutes, parseDuration } from '../duration';
import { isHeld, POLL } from '../maintenance';
import { lastTimerFor, type LastTimer } from '../lastTimer';
import { call, CallError, t } from '../messaging';
import { pageIssue, withSelection } from '../page';
import { defaultPresetName, filterPresets, hasPreset, presetRows, presetsFor, removePreset, renamePreset, savePreset, type Preset, type PresetRow } from '../presets';
import { getLastTimer, getMappings, getPresets, getSettings, savePresets } from '../storage';
import { composeNotes, entryMatchesIssue, suggest, type Suggestion } from '../suggest';
import type { Entry, Issue, ProjectOption, State, Summary, WeekSheet } from '../types';

const app = document.getElementById('app')!;
const isWindow = new URLSearchParams(location.search).has('window');
if (isWindow) document.body.classList.add('window');

let state: State = { connected: false, running: null, projects: [], entries: [], weekStart: '', weekLocked: false, fetchedAt: 0, pulseToken: '', skewMs: 0, downUntil: null };
let issue: Issue | null = null;
let workspace = '';
let noteFormat: 'identifier_title_url' | 'title_url' | 'title' = 'identifier_title_url';
let recent: string[] = [];
let tick: number | undefined;
let watch: number | undefined;

// The day the list shows and the week it came from. The toolbar popup is a
// view of the day with the form as a sheet over it; the detached window is
// the form for one issue.
let view: 'main' | 'form' | 'summary' = 'main';
let selectedDate = toDateString(new Date());
let sheet: WeekSheet = { entries: [], weekStart: '', weekLocked: false };
let editing: Entry | null = null;
/** Redrawn every second while something runs: the running card, its row, the day total. */
let tickers: (() => void)[] = [];

// Saved starting points and the last timer (board #268), both per workspace.
let presets: Preset[] = [];
let last: LastTimer | null = null;
let presetsOpen = false;
let presetQuery = '';
/** The preset being renamed, and the one whose ✕ was pressed once. */
let renaming: string | null = null;
let confirmingDelete: string | null = null;

const today = () => toDateString(new Date());
// Against the server's clock: start times came from the server, so a browser
// running fast would otherwise show work nobody did.
const now = () => Date.now() - state.skewMs;

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

/** The running card's clock, to the second. */
const elapsed = (entry: Entry): string => {
    const secs = Math.max(0, Math.floor((now() - new Date(entry.timer_started_at!).getTime()) / 1000)) + entry.minutes * 60;
    return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
};

const shortDate = (date: string): string => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const dayLabel = (date: string): string =>
    date === today() ? t('popup_today_date', shortDate(date)) : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

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
    const links = el('span', { class: 'links' }, [settings]);
    if (!isWindow && state.connected) {
        const insights = el('a', { href: '#', text: t('popup_insights') });
        insights.addEventListener('click', (e) => {
            e.preventDefault();
            if (view === 'summary') renderMain();
            else renderSummary();
        });
        links.prepend(insights);
    }
    return el('div', { class: 'brand' }, [el('strong', { text: 'Zebu' }), links]);
}

const units = () => ({ hour: t('unit_hour'), minute: t('unit_minute'), day: t('unit_day'), week: t('unit_week') });
const money = (cents: number) => (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** The desktop's Insights window, as a view: six tiles, uninvoiced this month, and hours per day. */
function summaryContent(s: Summary): (Node | string)[] {
    const tile = (label: string, value: string) => el('div', { class: 'tile' }, [el('span', { text: label }), el('strong', { text: value })]);
    const grid = el('div', { class: 'summary-grid' }, [
        tile(t('summary_hours_today'), formatMinutes(s.today)),
        tile(t('summary_hours_yesterday'), formatMinutes(s.yesterday)),
        tile(t('summary_hours_this_week'), formatMinutes(s.this_week)),
        tile(t('summary_hours_last_week'), formatMinutes(s.last_week)),
        tile(t('summary_hours_this_month'), formatMinutes(s.this_month)),
        tile(t('summary_billable_this_month'), `${s.billable_pct_month}%`),
    ]);
    const row = (label: string, value: string, cls = 'uninv-row') => el('div', { class: cls }, [el('span', { text: label }), el('strong', { text: value })]);
    const uninvoiced = el('div', { class: 'summary-uninv' }, [
        el('p', { class: 'uninv-title', text: t('summary_uninvoiced_this_month') }),
        row(t('summary_time'), formatDurationHuman(s.uninvoiced_minutes, units())),
        ...Object.entries(s.uninvoiced_amounts ?? {}).map(([currency, cents]) => row(currency, money(cents))),
        s.uninvoiced_total ? row(t('summary_approx_total', s.base_currency), money(s.uninvoiced_total), 'uninv-row uninv-total') : '',
    ]);
    const days = s.month_by_day ?? [];
    const max = Math.max(...days, 60);
    const todayIndex = new Date().getDate() - 1;
    const chart = el('div', { class: 'mini-chart' });
    days.forEach((m, i) => {
        const bar = el('span', { class: i === todayIndex ? 'today' : '', title: `${i + 1}: ${formatMinutes(m)}` }, [el('i')]);
        (bar.firstChild as HTMLElement).style.height = `${Math.max(4, (m / max) * 100)}%`;
        chart.append(bar);
    });
    const month = new Date().toLocaleDateString(undefined, { month: 'long' });
    return [el('h2', { text: t('popup_insights') }), grid, uninvoiced, chart, el('p', { class: 'notice caption', text: t('summary_hours_per_day', month) })];
}

function renderSummary(): void {
    view = 'summary';
    window.clearInterval(tick);
    const card = el('div', { class: 'card summary' }, [el('h2', { text: t('popup_insights') })]);
    app.replaceChildren(header(), card);
    void call<Summary>({ type: 'summary:get' })
        .then((s) => {
            if (view !== 'summary') return;
            card.replaceChildren(...summaryContent(s));
            // the figures include the running timer, so re-ask while the view is up
            window.setTimeout(() => {
                if (view === 'summary') renderSummary();
            }, 20000);
        })
        .catch((e) => card.append(el('p', { class: 'error', text: errorText(e) })));
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

async function loadSheet(): Promise<void> {
    sheet = await call<WeekSheet>({ type: 'sheet:get', date: selectedDate });
}

async function reload(): Promise<void> {
    state = await call<State>({ type: 'state:get' });
    await loadSheet();
    presets = await getPresets();
    last = lastTimerFor(await getLastTimer(), workspace);
}

/** Run a change on the server, then redraw the day from what the service worker now holds. */
async function act(fn: () => Promise<unknown>, error: HTMLElement, busy?: HTMLButtonElement): Promise<void> {
    if (busy) busy.disabled = true;
    try {
        await fn();
        await reload();
        editing = null;
        view = 'main';
        render();
    } catch (e) {
        error.textContent = errorText(e);
        if (busy) busy.disabled = false;
    }
}

async function goDate(date: string): Promise<void> {
    selectedDate = date;
    await loadSheet();
    render();
}

function openForm(entry: Entry | null): void {
    editing = entry;
    view = 'form';
    void renderForm();
}

function renderNotConnected(): void {
    const button = el('button', { class: 'btn', text: t('popup_connect') });
    button.addEventListener('click', () => void chrome.runtime.openOptionsPage());
    app.replaceChildren(header(), el('div', { class: 'card' }, [el('p', { text: t('popup_not_connected') }), button]));
}

function runningCard(entry: Entry): HTMLElement {
    const time = el('div', { class: 'elapsed', text: elapsed(entry) });
    tickers.push(() => (time.textContent = elapsed(entry)));

    const startedAt = new Date(entry.timer_started_at!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const stop = el('button', { class: 'btn danger', text: t('popup_stop') }) as HTMLButtonElement;
    const error = el('p', { class: 'error' });
    stop.addEventListener('click', () => void act(() => call({ type: 'timer:stop' }), error, stop));
    const open = el('a', { class: 'btn secondary', href: `${workspace}/time`, target: '_blank', rel: 'noopener', text: t('popup_open_zebu') });

    return el('div', { class: 'card running' }, [
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
    ]);
}

function entryRow(entry: Entry, error: HTMLElement): HTMLElement {
    const editable = !entry.locked && !sheet.weekLocked;
    const running = !!entry.timer_started_at;

    const text = el('div', { class: `entry-text${editable ? ' editable' : ''}`, ...(editable ? { title: t('popup_edit_entry') } : {}) }, [
        el('span', { class: 'entry-project', text: [entry.project, entry.task].filter(Boolean).join(' · ') }),
        el('span', { class: 'entry-sub', text: entry.notes ?? '' }),
    ]);
    if (editable) text.addEventListener('click', () => openForm(entry));

    const time = el('span', { class: 'entry-time', text: formatMinutes(elapsedMinutes(entry, now())) });
    if (running) tickers.push(() => (time.textContent = formatMinutes(elapsedMinutes(entry, now()))));

    const children: (Node | string)[] = [text, time];
    if (running) {
        const stop = el('button', { type: 'button', class: 'entry-btn stop', title: t('popup_stop'), text: '■' }) as HTMLButtonElement;
        stop.addEventListener('click', () => void act(() => call({ type: 'timer:stop' }), error, stop));
        children.push(stop);
    } else if (editable) {
        const play = el('button', { type: 'button', class: 'entry-btn play', title: t('popup_resume_title'), text: '▶' }) as HTMLButtonElement;
        play.addEventListener('click', () => void act(() => call({ type: 'timer:resume', entryId: entry.id, projectId: entry.project_id }), error, play));
        children.push(play);
    }
    if (entry.locked) children.push(el('span', { class: 'entry-lock', title: t('popup_invoiced'), text: '🔒' }));

    return el('div', { class: `entry${running ? ' running' : ''}` }, children);
}

/** One-click resume of the last timer when nothing runs, as the desktop's ▶ Resume bar. */
function resumeRow(error: HTMLElement): HTMLElement | '' {
    if (state.running || !last) return '';
    const l = last;
    // an older day is not resumed in place: a fresh timer starts today
    const fresh = l.date !== today();
    const button = el('button', { type: 'button', class: 'resume', title: fresh ? t('popup_resume_fresh_title', shortDate(l.date)) : t('popup_resume_title') }, [
        el('span', { class: 'resume-play', text: '▶' }),
        el('span', { class: 'resume-text', text: `${t('popup_resume')} — ${[l.project, l.task].filter(Boolean).join(' · ')}` }),
    ]) as HTMLButtonElement;
    button.addEventListener('click', () => void act(() => call({ type: 'timer:resume-last' }), error, button));
    return button;
}

function presetRow(row: PresetRow, redraw: () => void, error: HTMLElement): HTMLElement {
    const wrap = el('div', { class: `preset-row${row.missing ? ' missing' : ''}` });
    if (renaming === row.preset.id) {
        const input = el('input', { type: 'text', class: 'preset-rename', 'aria-label': t('popup_preset_rename'), spellcheck: 'false' }) as HTMLInputElement;
        input.value = row.preset.name;
        // Enter, the ✓, or the field losing focus: all the same thing.
        const commit = async () => {
            if (renaming !== row.preset.id) return;
            renaming = null;
            presets = renamePreset(presets, row.preset.id, input.value);
            await savePresets(presets);
            redraw();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                renaming = null;
                redraw();
            }
        });
        input.addEventListener('blur', () => void commit());
        const done = el('button', { type: 'button', class: 'preset-icon', title: t('popup_preset_done'), text: '✓' });
        done.addEventListener('mousedown', (e) => {
            e.preventDefault();
            void commit();
        });
        wrap.append(input, done);
        queueMicrotask(() => input.select());
        return wrap;
    }
    const start = el('button', { type: 'button', class: 'preset-start', title: row.missing ? t('popup_preset_missing') : t('popup_preset_start', row.preset.name) }, [
        el('span', { class: 'preset-name', text: row.preset.name }),
        el('span', { class: 'preset-sub', text: row.missing ? t('popup_preset_missing') : row.subtitle }),
    ]) as HTMLButtonElement;
    start.disabled = row.missing;
    start.addEventListener('click', () => {
        presetsOpen = false;
        void act(() => call({ type: 'timer:start', issue: null, projectId: row.preset.project_id, taskId: row.preset.task_id || null, notes: '' }), error, start);
    });
    wrap.append(start);
    if (confirmingDelete === row.preset.id) {
        // two presses, because there is no undo
        const confirm = el('button', { type: 'button', class: 'preset-confirm', text: t('popup_preset_confirm_delete') });
        confirm.addEventListener('click', async () => {
            confirmingDelete = null;
            presets = removePreset(presets, row.preset.id);
            await savePresets(presets);
            redraw();
        });
        wrap.append(confirm);
    } else {
        const rename = el('button', { type: 'button', class: 'preset-icon', title: t('popup_preset_rename'), text: '✎\uFE0E' });
        rename.addEventListener('click', () => {
            confirmingDelete = null;
            renaming = row.preset.id;
            redraw();
        });
        const remove = el('button', { type: 'button', class: 'preset-icon danger', title: t('popup_preset_delete'), text: '✕' });
        remove.addEventListener('click', () => {
            confirmingDelete = row.preset.id;
            redraw();
        });
        wrap.append(rename, remove);
    }
    return wrap;
}

/** The ☆ list: search, start, rename, delete. Rows redraw in place so the search keeps its focus. */
function presetsPanel(error: HTMLElement): HTMLElement {
    const search = el('input', { type: 'search', placeholder: t('popup_presets_search'), autocomplete: 'off' }) as HTMLInputElement;
    search.value = presetQuery;
    const rows = el('div', { class: 'preset-rows' });
    const draw = () => {
        rows.replaceChildren();
        const all = presetRows(presetsFor(presets, workspace), state.projects);
        const visible = filterPresets(all, presetQuery);
        for (const row of visible) rows.append(presetRow(row, draw, error));
        if (!all.length) rows.append(el('p', { class: 'preset-empty', text: t('popup_presets_none') }));
        else if (!visible.length) rows.append(el('p', { class: 'preset-empty', text: t('popup_presets_no_match') }));
    };
    search.addEventListener('input', () => {
        presetQuery = search.value;
        draw();
    });
    draw();
    queueMicrotask(() => search.focus());
    return el('div', { class: 'presets' }, [el('div', { class: 'group', text: t('popup_presets') }), search, rows]);
}

function dayCard(): HTMLElement {
    const entries = sheet.entries.filter((e) => e.date === selectedDate);
    const error = el('p', { class: 'error' });

    const sum = () => formatMinutes(entries.reduce((s, e) => s + elapsedMinutes(e, now()), 0));
    const total = el('span', { class: 'total', text: sum() });
    if (entries.some((e) => e.timer_started_at)) tickers.push(() => (total.textContent = sum()));

    const prev = el('button', { type: 'button', title: t('popup_prev_day'), text: '‹' });
    const next = el('button', { type: 'button', title: t('popup_next_day'), text: '›' });
    prev.addEventListener('click', () => void goDate(shiftDate(selectedDate, -1)));
    next.addEventListener('click', () => void goDate(shiftDate(selectedDate, 1)));

    const list = el('div', { class: 'entries' });
    for (const entry of entries) list.append(entryRow(entry, error));
    if (!entries.length) list.append(el('div', { class: 'empty-day', text: t('popup_no_entries') }));

    const add = el('button', { class: 'btn secondary', text: selectedDate === today() ? t('popup_new_timer') : t('popup_add_entry') });
    add.addEventListener('click', () => openForm(null));
    const star = el('button', { class: `btn secondary star${presetsOpen ? ' active' : ''}`, title: t('popup_presets'), text: '☆' });
    star.addEventListener('click', () => {
        presetsOpen = !presetsOpen;
        renaming = null;
        confirmingDelete = null;
        renderMain();
    });

    return el('div', { class: 'card' }, [
        resumeRow(error),
        el('div', { class: 'daynav' }, [prev, el('span', { class: 'label', text: dayLabel(selectedDate) }), total, next]),
        sheet.weekLocked ? el('p', { class: 'notice', text: t('popup_week_locked') }) : '',
        list,
        error,
        sheet.weekLocked ? '' : el('div', { class: 'row' }, [add, star]),
        sheet.weekLocked || !presetsOpen ? '' : presetsPanel(error),
    ]);
}

function renderMain(): void {
    view = 'main';
    window.clearInterval(tick);
    tickers = [];
    app.replaceChildren(header(), ...(state.running ? [runningCard(state.running)] : []), dayCard());
    if (tickers.length) tick = window.setInterval(() => tickers.forEach((fn) => fn()), 1000);
}

async function renderForm(): Promise<void> {
    view = 'form';
    window.clearInterval(tick);
    const isToday = selectedDate === today();
    // A new entry starts from the page or issue; an edit starts from the entry itself.
    const from = editing ? null : issue;
    const mappings = await getMappings();
    const ranked = suggest(from, state.projects, mappings, recent);
    const suggested = ranked.filter((s) => s.reason !== 'recent' && s.score >= 0.45).slice(0, 4);

    let selected: Suggestion | null = editing ? (ranked.find((s) => s.project.id === editing!.project_id) ?? null) : (suggested[0] ?? null);
    if (editing && selected) selected = { ...selected, taskId: editing.task_id };
    let filter = '';

    const search = el('input', { type: 'search', placeholder: t('popup_project_search'), autocomplete: 'off' }) as HTMLInputElement;
    const list = el('div', { class: 'projects', role: 'listbox' });
    const taskSelect = el('select') as HTMLSelectElement;
    const notes = el('textarea') as HTMLTextAreaElement;
    notes.value = editing ? (editing.notes ?? '') : from ? composeNotes(from, noteFormat) : '';
    // The prefill: only a changed duration rebases a live timer.
    const openedDuration = editing ? formatMinutes(elapsedMinutes(editing, now())) : '';
    const duration = el('input', { type: 'text', placeholder: '1:30', autocomplete: 'off', value: openedDuration }) as HTMLInputElement;
    const error = el('p', { class: 'error' });
    const submit = el('button', { class: 'btn' }) as HTMLButtonElement;
    const notice = el('p', { class: 'notice', text: t('popup_switch_note', state.running?.project ?? '') });

    // What the button does follows the duration, the desktop's rule: empty
    // starts a timer, a value logs a finished block. Only today can start one.
    const syncSubmit = () => {
        const logging = duration.value.trim() !== '' || !isToday;
        submit.textContent = editing ? t('popup_save') : logging ? t('popup_log') : t('popup_start');
        notice.hidden = !(state.running && !editing && !logging);
    };
    duration.addEventListener('input', syncSubmit);

    // The starting point this form describes, offered as a preset once it has
    // a project; already saved, the control says so instead of offering again.
    const presetButton = el('button', { type: 'button', class: 'link preset-save' }) as HTMLButtonElement;
    const presetDraft = () => (selected ? { name: defaultPresetName(selected.project, taskSelect.value), project_id: selected.project.id, task_id: taskSelect.value, workspace } : null);
    const syncPreset = () => {
        const draft = presetDraft();
        presetButton.hidden = !!editing || !draft;
        if (!draft) return;
        const saved = hasPreset(presets, draft);
        presetButton.textContent = saved ? t('popup_preset_saved') : t('popup_preset_save');
        presetButton.disabled = saved;
    };
    presetButton.addEventListener('click', async () => {
        const draft = presetDraft();
        if (!draft) return;
        presets = savePreset(presets, draft);
        await savePresets(presets);
        syncPreset();
    });
    taskSelect.addEventListener('change', syncPreset);

    const renderTasks = () => {
        taskSelect.replaceChildren(el('option', { value: '', text: t('popup_task_none') }));
        for (const task of selected?.project.tasks ?? []) taskSelect.append(el('option', { value: task.id, text: task.name }));
        taskSelect.value = selected?.taskId ?? '';
        taskSelect.disabled = !selected || selected.project.tasks.length === 0;
        submit.disabled = !selected;
        syncPreset();
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

    submit.addEventListener('click', async () => {
        if (!selected) return;
        const typed = duration.value.trim();
        const minutes = typed ? parseDuration(typed) : null;
        // A block needs a real duration; a timer can only start today.
        if ((typed && (minutes === null || minutes <= 0)) || (!editing && !typed && !isToday)) {
            error.textContent = t('popup_error_duration');
            return;
        }
        const projectId = selected.project.id;
        const taskId = taskSelect.value || null;
        submit.disabled = true;
        if (!editing && minutes === null) submit.textContent = t('popup_starting');
        try {
            if (editing) {
                await call({ type: 'entry:update', id: editing.id, projectId, taskId, notes: notes.value, minutes: typed !== openedDuration && minutes !== null ? minutes : null });
            } else if (minutes !== null) {
                await call({ type: 'entry:add', issue: from, projectId, taskId, date: selectedDate, minutes, notes: notes.value });
            } else {
                await call<Entry>({ type: 'timer:start', issue: from, projectId, taskId, notes: notes.value });
                if (isWindow) {
                    window.close();
                    return;
                }
            }
            if (isWindow) {
                window.close();
                return;
            }
            issue = null;
            editing = null;
            await reload();
            renderMain();
        } catch (e) {
            error.textContent = errorText(e);
            submit.disabled = false;
            syncSubmit();
        }
    });

    const actions = el('div', { class: 'row' }, [submit]);
    if (!isWindow) {
        const cancel = el('button', { class: 'btn secondary', text: t('popup_cancel') });
        cancel.addEventListener('click', () => {
            editing = null;
            renderMain();
        });
        actions.append(cancel);
    }
    let remove: HTMLButtonElement | '' = '';
    if (editing) {
        const id = editing.id;
        const button = el('button', { class: 'btn danger', text: t('popup_delete') }) as HTMLButtonElement;
        // Two clicks and no dialog: the first only asks.
        let armed = false;
        button.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                button.textContent = t('popup_delete_confirm');
                return;
            }
            void act(() => call({ type: 'entry:delete', id }), error, button);
        });
        remove = button;
    }

    renderList();
    renderTasks();
    syncSubmit();

    const heading = editing ? t('popup_edit_entry') : from ? t(from.site === 'page' ? 'popup_for_page' : 'popup_for_issue') : isToday ? t('popup_new_timer') : t('popup_add_entry');
    const card = el('div', { class: 'card' }, [
        el('h2', { text: heading }),
        from
            ? el('div', { class: 'issue' }, [
                  from.identifier ? el('span', { class: 'id', text: from.identifier }) : '',
                  el('span', { class: 'title', text: from.title }),
                  el('span', { class: 'where', text: from.container }),
              ])
            : '',
        el('label', { text: t('popup_project') }),
        search,
        list,
        el('label', { text: t('popup_task') }),
        taskSelect,
        presetButton,
        el('label', { text: t('popup_duration') }),
        duration,
        el('label', { text: t('popup_notes') }),
        notes,
        notice,
        error,
        actions,
        remove,
    ]);
    app.replaceChildren(header(), card);
    if (!selected) search.focus();
    else if (!editing && !isToday) duration.focus();
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
            if (!changed) return watchTimer();
            // Only redraw on a real change, and never over the form: it holds
            // what the user is half way through typing.
            await loadSheet();
            if (view === 'form') watchTimer();
            else render();
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
    if (isWindow) {
        // A page handed us an issue: go straight to the form, unless this very
        // issue is what's already running (then show it so it can be stopped).
        if (issue && !(state.running && entryMatchesIssue(state.running.notes, issue))) return void renderForm();
        if (!state.running) return void renderForm();
        return renderMain();
    }
    if (view === 'form') return void renderForm();
    renderMain();
}

(async () => {
    const settings = await getSettings();
    workspace = settings.workspace;
    noteFormat = settings.noteFormat;
    try {
        state = await call<State>({ type: 'state:get' });
        // The toolbar popup is handed no issue, but it has the page it was
        // opened over: title, link and selection prefill a new timer.
        issue = isWindow ? await call<Issue | null>({ type: 'issue:pending:get' }) : await capturePage();
        if (state.connected) await loadSheet();
        presets = await getPresets();
        last = lastTimerFor(await getLastTimer(), workspace);
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
