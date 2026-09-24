// The timer UI, laid out as the desktop menubar popover is: a header naming
// the day, a week strip with each day's total, the day's entries with ▶/■ on
// each row, and a footer with ＋ (new entry), ☆ (presets) and ⚙ (settings).
// The entry sheet, the presets list and the settings panel open over it.
//
// Opens two ways: from the toolbar icon (the day view, prefilled with the page
// underneath when ＋ is pressed) and as a small window from a page's "Track
// time" button (the sheet open over the day, for that issue). Vanilla DOM on
// purpose — it starts instantly.
import { headerDate, relativeDay, shiftDate, toDateString } from '../dates';
import { elapsedMinutes, formatDurationHuman, formatMinutes } from '../duration';
import { durationToSave, isApplePlatform, isSaveShortcut, saveShortcutHint } from '../entryForm';
import { budgetLevel, formatHoursShort } from '../entryStats';
import { readIdlePrefill } from '../idle';
import { lastTimerFor, resumeLabelKey, resumeWork, type LastTimer } from '../lastTimer';
import { isHeld, POLL } from '../maintenance';
import { call, CallError, errorText, t } from '../messaging';
import { pageIssue, withSelection } from '../page';
import { defaultPresetName, filterPresets, hasPreset, presetRows, presetsFor, removePreset, renamePreset, savePreset, type Preset, type PresetRow } from '../presets';
import { getLastTimer, getMappings, getPresets, getSettings, savePresets, saveSettings } from '../storage';
import { composeNotes, entryMatchesIssue, suggest } from '../suggest';
import { DEFAULT_SETTINGS, type Entry, type Issue, type Mappings, type ProjectStats, type Settings, type State, type WeekSheet } from '../types';
import { weekDays } from '../week';
import { DEFAULT_DOMAIN, isWorkspaceName, workspaceName } from '../workspace';
import { el, ICON_CHART, ICON_GEAR, ICON_PENCIL, svg } from './dom';
import { insightsPanel, type Insights } from './insights';
import { projectPicker } from './picker';

const app = document.getElementById('app')!;
const isWindow = new URLSearchParams(location.search).has('window');
/** Idle time removed from a timer, opened here to be added as a new entry (board #333). */
const idleEntry = isWindow ? readIdlePrefill(location.search) : null;
if (isWindow) document.body.classList.add('window');

let state: State = { connected: false, running: null, projects: [], entries: [], weekStart: '', weekLocked: false, projectStats: {}, fetchedAt: 0, pulseToken: '', skewMs: 0, downUntil: null, live: false };
let settings: Settings = DEFAULT_SETTINGS;
/** The page or issue a new timer is about: handed over by a page, or the tab under the toolbar popup. */
let issue: Issue | null = null;
let mappings: Mappings = {};
let recent: string[] = [];
let tick: number | undefined;
let watch: number | undefined;

// What is on screen. The day list is the base; everything else opens over it.
let view: 'main' | 'insights' = 'main';
let selectedDate = toDateString(new Date());
let sheet: WeekSheet = { entries: [], weekStart: '', weekLocked: false, projectStats: {} };
let errorMessage = '';
let formOpen = false;
let editing: Entry | null = null;
let confirmNewDay = false;
let presetsOpen = false;
let settingsOpen = false;
let settingsTab: 'settings' | 'shortcuts' = 'settings';
let insights: Insights | null = null;
/** Redrawn every few seconds while a clock runs: the running row, its day in the strip, the banner. */
let tickers: (() => void)[] = [];

// Saved starting points and the last timer (board #268), both per workspace.
let presets: Preset[] = [];
let last: LastTimer | null = null;
let presetQuery = '';
let renaming: string | null = null;
let confirmingDelete: string | null = null;

const today = () => toDateString(new Date());
// Against the server's clock: start times came from the server, so a browser
// running fast would otherwise show work nobody did.
const now = () => Date.now() - state.skewMs;
const workspace = () => settings.workspace;

const shortDate = (date: string): string => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** "Today, Thu Sep 24" or "Tue Sep 22" (board #422). */
const headerLabel = (): string => {
    const day = headerDate(selectedDate, chrome.i18n.getUILanguage());
    return selectedDate === today() ? t('popup_today_date', day) : day;
};

/** The Appearance setting, as the desktop applies it: no attribute follows the system. */
const applyTheme = () => {
    if (settings.appearance === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.appearance;
};

const openInTab = (url: string) => void chrome.tabs.create({ url });

// ---- data --------------------------------------------------------------------

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

async function loadLocal(): Promise<void> {
    presets = await getPresets();
    last = lastTimerFor(await getLastTimer(), workspace());
    mappings = await getMappings();
    recent = Object.values(mappings)
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .map((m) => m.projectId)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .slice(0, 8);
}

async function reload(): Promise<void> {
    state = await call<State>({ type: 'state:get' });
    if (state.connected) await loadSheet();
    await loadLocal();
}

const closeOverlays = () => {
    formOpen = false;
    editing = null;
    confirmNewDay = false;
    presetsOpen = false;
    settingsOpen = false;
    renaming = null;
    confirmingDelete = null;
};

/** Run a change on the server, then redraw the day from what the service worker now holds. */
async function act(fn: () => Promise<unknown>, error?: HTMLElement, busy?: HTMLButtonElement): Promise<void> {
    if (busy) busy.disabled = true;
    try {
        await fn();
        await reload();
        errorMessage = '';
        closeOverlays();
        render();
    } catch (e) {
        if (error) error.textContent = errorText(e);
        else {
            errorMessage = errorText(e);
            render();
        }
        if (busy) busy.disabled = false;
    }
}

/** Starting or resuming a timer jumps to the entry's day, so the running row is on screen. */
const showEntry = (entry: Entry | null | undefined) => {
    if (entry && entry.date !== selectedDate) selectedDate = entry.date;
};

async function goDate(date: string): Promise<void> {
    selectedDate = date;
    try {
        await loadSheet();
        errorMessage = '';
    } catch (e) {
        errorMessage = errorText(e);
    }
    render();
}

const shiftWeek = (weeks: number) => void goDate(shiftDate(selectedDate, weeks * 7));

const stopTimer = (busy?: HTMLButtonElement) => void act(() => call({ type: 'timer:stop' }), undefined, busy);
const resumeEntry = (entry: Entry, busy?: HTMLButtonElement) =>
    void act(() => call<State>({ type: 'timer:resume', entryId: entry.id, projectId: entry.project_id }).then(() => showEntry(entry)), undefined, busy);

/** One-click resume of the last timer; an older day's entry asks first: resume it on its own day, or start today. */
const resumeLast = () => {
    if (!last || state.running) return;
    if (last.date !== today()) {
        confirmNewDay = true;
        render();
        return;
    }
    void act(() => call<State>({ type: 'timer:resume-last' }).then((s) => showEntry(s.running)));
};

const openForm = (entry: Entry | null) => {
    if (entry && (entry.locked || sheet.weekLocked)) return;
    editing = entry;
    formOpen = true;
    presetsOpen = false;
    settingsOpen = false;
    render();
};

// Minutes the running timer has accrued beyond the stored `minutes` the
// server summed — added to the totals the timer belongs in, on each tick.
const runningExtra = (): number => (state.running ? Math.max(0, elapsedMinutes(state.running, now()) - state.running.minutes) : 0);

const projectOf = (entry: Entry) => state.projects.find((p) => p.id === entry.project_id) ?? null;

const statsFor = (entry: Entry): ProjectStats | null => {
    const stats = sheet.projectStats?.[entry.project_id];
    if (!stats) return null;
    const r = state.running;
    const extra = runningExtra();
    if (!r || r.project_id !== entry.project_id || !extra) return stats;
    return { ...stats, total_minutes: stats.total_minutes + extra, uninvoiced_minutes: stats.uninvoiced_minutes + (r.is_billable ? extra : 0) };
};


// ---- the day view --------------------------------------------------------------

function header(): HTMLElement {
    const toggleInsights = () => {
        view = view === 'insights' ? 'main' : 'insights';
        presetsOpen = false;
        settingsOpen = false;
        render();
    };
    const actions = el('div', { class: 'header-actions' });
    if (view === 'insights') {
        // the panel's name sits where the chart button was; the way back is on the left
        const back = el('button', { type: 'button', class: 'header-back', text: `‹ ${t('popup_back_to_timers')}` });
        back.addEventListener('click', toggleInsights);
        actions.append(el('span', { class: 'header-label', text: t('popup_insights') }));
        return el('header', { class: 'header' }, [back, actions]);
    }
    if (selectedDate !== today()) {
        const jump = el('button', { type: 'button', title: t('header_jump_today'), text: `${t('header_today')} ⤴︎` });
        jump.addEventListener('click', () => void goDate(today()));
        actions.append(jump);
    }
    const chart = el('button', { type: 'button', title: t('popup_insights') }, [svg('icon-chart', 13, ICON_CHART)]);
    chart.addEventListener('click', toggleInsights);
    actions.append(chart);
    const title = el('span', { class: 'header-title' }, [headerLabel()]);
    return el('header', { class: 'header' }, [title, actions]);
}

function weekStrip(): HTMLElement {
    const prev = el('button', { type: 'button', class: 'week-nav', title: t('popup_prev_week'), text: '‹' });
    const next = el('button', { type: 'button', class: 'week-nav', title: t('popup_next_week'), text: '›' });
    prev.addEventListener('click', () => shiftWeek(-1));
    next.addEventListener('click', () => shiftWeek(1));
    const strip = el('div', { class: 'week' }, [prev]);
    // no week fetched yet (an error on first load): still draw the days around the selected one
    const weekStart = sheet.weekStart || shiftDate(selectedDate, -((new Date(`${selectedDate}T00:00:00`).getDay() + 6) % 7));
    for (const day of weekDays(weekStart, sheet.entries, now())) {
        const total = el('span', { class: 'day-total', text: formatMinutes(day.minutes) });
        if (state.running?.date === day.date) {
            tickers.push(() => (total.textContent = formatMinutes(weekDays(weekStart, sheet.entries, now()).find((d) => d.date === day.date)?.minutes ?? 0)));
        }
        const button = el('button', { type: 'button', class: `day${day.date === selectedDate ? ' selected' : ''}` }, [el('span', { class: 'day-letter', text: day.letter }), total]);
        button.addEventListener('click', () => void goDate(day.date));
        strip.append(button);
    }
    strip.append(next);
    return strip;
}

/**
 * The resume bar's work, drawn as an entry row draws it (board #411): the
 * client small and muted on its own line, the project (and task) below. A
 * value stored before the client was looks it up in today's project list.
 */
function resumeText(l: LastTimer): HTMLElement {
    const client = l.client ?? state.projects.find((p) => p.id === l.project_id)?.client ?? null;
    const work = resumeWork(l);
    return el('span', { class: 'entry-text resume-text' }, [
        client ? el('span', { class: 'entry-client', text: client }) : '',
        el('span', { class: 'entry-project', text: work, title: work }),
    ]);
}

/** The desktop's ▶ Resume bar: one click on the last timer when nothing runs. */
function resumeBar(): HTMLElement | '' {
    if (state.running || !last) return '';
    const l = last;
    const button = el('button', { type: 'button', class: 'running-elsewhere resume-last' }, [
        el('span', { class: 'resume-heading', text: t('popup_last_active') }),
        el('span', { class: 'resume-row' }, [resumeText(l), el('span', { class: 'resume-action', text: `▶ ${t(resumeLabelKey(l, today()))}` })]),
    ]);
    button.addEventListener('click', resumeLast);
    return button;
}

/** A timer running on a day other than the one shown, pinned above the list as a jump target. */
function runningElsewhere(): HTMLElement | '' {
    const r = state.running;
    if (!r || r.date === selectedDate) return '';
    const time = el('span', { class: 'running-elsewhere-time', text: formatMinutes(elapsedMinutes(r, now())) });
    tickers.push(() => (time.textContent = formatMinutes(elapsedMinutes(r, now()))));
    const banner = el('button', { type: 'button', class: 'running-elsewhere' }, [
        el('span', { class: 're-head' }, [
            el('span', { class: 'dot-live' }),
            el('span', { class: 'running-elsewhere-text', text: t('popup_running_since', shortDate(r.date)) }),
            el('span', { class: 'running-elsewhere-jump', text: '⤴︎' }),
        ]),
        el('span', { class: 're-divider' }),
        el('span', { class: 're-entry' }, [
            el('span', { class: 're-text' }, [
                el('span', { class: 're-project', text: r.project ?? '' }),
                el('span', { class: 're-sub', text: [r.task, r.notes].filter(Boolean).join(' — ') || ' ' }),
            ]),
            time,
        ]),
    ]);
    banner.addEventListener('click', () => void goDate(r.date));
    return banner;
}

function entryRow(entry: Entry): HTMLElement {
    const editable = !entry.locked && !sheet.weekLocked;
    const running = !!entry.timer_started_at;
    const project = projectOf(entry);

    const projectLine = el('span', { class: 'entry-project' });
    if (project?.code) projectLine.append(el('span', { class: 'entry-code', text: project.code }));
    projectLine.append(entry.project ?? '');
    // agentic work: what the Claude Code hook measured on this timer
    if (entry.agent_waiting || (entry.waiting_minutes ?? 0) > 0) {
        const label = entry.agent_waiting && !(entry.waiting_minutes ?? 0) ? t('popup_waiting_now') : `⏳ ${t('popup_waiting', String(entry.waiting_minutes ?? 0))}${entry.agent_waiting ? ' …' : ''}`;
        projectLine.append(el('span', { class: `entry-waiting${entry.agent_waiting ? ' live' : ''}`, text: label }));
    }

    // "View project · Uninvoiced: 32h · Budget: 62%" (board #420). The link
    // sits inside the clickable text, so it stops the click reaching the
    // edit sheet.
    const viewProject = el('a', { class: 'entry-view-project', href: `${workspace()}/projects/${entry.project_id}`, target: '_blank', rel: 'noopener', text: t('entry_view_project') });
    viewProject.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openInTab(viewProject.href);
    });
    const stats = el('span', { class: 'entry-stats' });
    const drawStats = () => {
        const s = statsFor(entry);
        stats.replaceChildren(viewProject);
        if (!s) return;
        stats.append(el('span', { class: 'entry-stats-dim', text: ` · ${t('entry_uninvoiced')}: ${formatHoursShort(s.uninvoiced_minutes, chrome.i18n.getUILanguage())}` }));
        if (s.budget_pct !== null) {
            stats.append(el('span', { class: 'entry-stats-dim', text: ' · ' }), el('span', { class: `budget-pill ${budgetLevel(s.budget_pct)}`, text: `${t('entry_budget')}: ${s.budget_pct}%` }));
        }
    };
    drawStats();

    const text = el('div', { class: `entry-text${editable ? ' editable' : ''}`, ...(editable ? { title: t('popup_edit_entry') } : {}) }, [
        project?.client ? el('span', { class: 'entry-client', text: project.client }) : '',
        projectLine,
        el('span', { class: 'entry-sub', text: [entry.task, entry.notes].filter(Boolean).join(' — ') || ' ' }),
        stats,
    ]);
    if (editable) text.addEventListener('click', () => openForm(entry));

    const time = el('span', { class: 'entry-time', text: formatMinutes(elapsedMinutes(entry, now())) });
    if (state.running && (running || state.running.project_id === entry.project_id)) {
        tickers.push(() => {
            time.textContent = formatMinutes(elapsedMinutes(entry, now()));
            drawStats();
        });
    }

    const children: (Node | string)[] = [text, time];
    if (running) {
        const stop = el('button', { type: 'button', class: 'entry-btn stop', title: t('popup_stop'), text: '■' });
        stop.addEventListener('click', () => stopTimer(stop));
        children.push(stop);
    } else if (editable) {
        const play = el('button', { type: 'button', class: 'entry-btn play', title: t('popup_resume_title'), text: '▶' });
        play.addEventListener('click', () => resumeEntry(entry, play));
        children.push(play);
    }
    if (entry.locked) children.push(el('span', { class: 'entry-lock', title: t('popup_invoiced'), text: '🔒' }));

    return el('div', { class: `entry${running ? ' running' : ''}` }, children);
}

function entriesList(): HTMLElement {
    const entries = sheet.entries.filter((e) => e.date === selectedDate);
    const list = el('main', { class: 'entries' });
    if (errorMessage) list.append(el('p', { class: 'error', text: errorMessage }));
    if (sheet.weekLocked) list.append(el('p', { class: 'muted locked-note', text: t('popup_week_locked') }));
    if (!entries.length) {
        const empty = el('div', { class: `empty${state.running || last ? ' raised' : ''}` });
        if (!sheet.weekLocked) {
            const add = el('button', { type: 'button', class: 'btn-outline', text: selectedDate === today() ? t('popup_start') : t('popup_add_entry') });
            add.addEventListener('click', () => openForm(null));
            empty.append(add);
        }
        list.append(empty);
    }
    for (const entry of entries) list.append(entryRow(entry));
    return list;
}

function footer(): HTMLElement {
    const left = el('div', { class: 'footer-left' });
    if (!sheet.weekLocked) {
        const add = el('button', { type: 'button', title: t('popup_new_entry'), text: '＋' });
        add.addEventListener('click', () => openForm(null));
        const star = el('button', { type: 'button', class: presetsOpen ? 'active' : '', title: t('popup_presets'), text: '☆' });
        star.addEventListener('click', () => {
            presetsOpen = !presetsOpen;
            settingsOpen = false;
            presetQuery = '';
            renaming = null;
            confirmingDelete = null;
            render();
        });
        left.append(add, star);
    }
    const gear = el('button', { type: 'button', class: settingsOpen ? 'active' : '', title: t('popup_settings') }, [svg('icon-gear', 15, ICON_GEAR)]);
    gear.addEventListener('click', () => {
        settingsOpen = !settingsOpen;
        settingsTab = 'settings';
        presetsOpen = false;
        render();
    });
    return el('footer', { class: 'footer' }, [left, el('div', { class: 'footer-right' }, [gear])]);
}

// ---- overlays ------------------------------------------------------------------

/**
 * The last timer is from an earlier day (board #411): resume that entry on its
 * own date, or start a fresh one today. Only the "when" is bold; the sentence
 * around it is split on a sentinel, so no data goes through innerHTML.
 */
function newDaySheet(): HTMLElement {
    const close = () => {
        confirmNewDay = false;
        render();
    };
    const x = el('button', { type: 'button', class: 'sheet-close', 'aria-label': t('popup_close'), title: t('popup_close'), text: '×' });
    x.addEventListener('click', close);
    const l = last;
    const resumeOld = el('button', { type: 'button', class: 'btn-outline', text: t('newday_resume_old') });
    if (l) resumeOld.addEventListener('click', () => void act(() => call<State>({ type: 'timer:resume', entryId: l.entry_id, projectId: l.project_id }).then((s) => showEntry(s.running)), undefined, resumeOld));
    const startToday = el('button', { type: 'button', class: 'btn-primary', text: t('newday_start_today') });
    startToday.addEventListener('click', () => void act(() => call<State>({ type: 'timer:resume-last' }).then((s) => showEntry(s.running)), undefined, startToday));
    const SENTINEL = '\uE000';
    const [before, after = ''] = t('newday_body', SENTINEL).split(SENTINEL);
    const when = l ? relativeDay(l.date, today(), chrome.i18n.getUILanguage()) : '';
    const body = el('p', { class: 'newday-body' }, [before, el('strong', { text: when }), after]);
    const overlay = el('div', { class: 'sheet-overlay' }, [
        el('div', { class: 'sheet newday-sheet' }, [
            x,
            body,
            l ? el('div', { class: 'newday-head' }, [resumeText(l)]) : '',
            el('div', { class: 'sheet-actions' }, [resumeOld, startToday]),
        ]),
    ]);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    return overlay;
}

/** The entry sheet: a new timer or a logged block, or an existing entry's project, task, date, duration and notes. */
function entrySheet(): HTMLElement {
    const from = editing ? null : issue;
    const ranked = suggest(from, state.projects, mappings, recent);
    const suggested = ranked.filter((s) => s.reason !== 'recent' && s.score >= 0.45).slice(0, 4);
    let projectId = editing ? editing.project_id : (suggested[0]?.project.id ?? '');
    let taskId = editing ? (editing.task_id ?? '') : (suggested[0]?.taskId ?? '');
    const projectFor = (id: string) => state.projects.find((p) => p.id === id) ?? null;

    const error = el('p', { class: 'error' });
    const taskSelect = el('select');
    const presetButton = el('button', { type: 'button', class: 'link preset-save' });
    // ⌘↵ / Ctrl+↵ saves from any field (board #398); the keycap says so.
    const apple = isApplePlatform((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform);
    const submitLabel = el('span');
    const submit = el('button', { type: 'button', class: 'btn-primary', 'aria-keyshortcuts': apple ? 'Meta+Enter' : 'Control+Enter' }, [
        submitLabel,
        el('kbd', { class: 'kbd-hint', 'aria-hidden': 'true', text: saveShortcutHint(apple, t('popup_key_ctrl')) }),
    ]);
    const notice = el('p', { class: 'muted notice' });

    const date = el('input', { type: 'date', class: 'sheet-date' });
    date.value = editing ? editing.date : selectedDate;
    // The prefill: only a changed duration rebases a live timer.
    const openedDuration = editing ? formatMinutes(elapsedMinutes(editing, now())) : idleEntry ? formatMinutes(idleEntry.minutes) : '';
    const duration = el('input', { type: 'text', class: `duration${editing?.timer_started_at ? ' live' : ''}`, placeholder: '0:00', autocomplete: 'off' });
    duration.value = openedDuration;
    const notes = el('textarea', { rows: '2', class: 'sheet-notes', placeholder: t('popup_notes_placeholder') });
    notes.value = editing ? (editing.notes ?? '') : from ? composeNotes(from, settings.noteFormat) : '';
    const autosize = () => {
        notes.style.height = 'auto';
        notes.style.height = `${Math.min(notes.scrollHeight, 120)}px`;
    };
    notes.addEventListener('input', autosize);

    // What the button does follows the duration, the desktop's rule: empty
    // starts a timer, a value logs a finished block. A timer can only start today.
    const syncSubmit = () => {
        const logging = duration.value.trim() !== '' || date.value !== today();
        submitLabel.textContent = editing ? t('popup_save') : logging ? t('popup_log') : t('popup_start');
        submit.disabled = !projectId;
        notice.textContent = t('popup_switch_note', state.running?.project ?? '');
        notice.hidden = !(state.running && !editing && !logging);
    };
    duration.addEventListener('input', syncSubmit);
    date.addEventListener('change', syncSubmit);

    // The starting point this sheet describes, offered as a preset once it has
    // a project; already saved, the control says so instead of offering again.
    const presetDraft = () => (projectId ? { name: defaultPresetName(projectFor(projectId), taskId), project_id: projectId, task_id: taskId, workspace: workspace() } : null);
    const syncPreset = () => {
        const draft = presetDraft();
        presetButton.hidden = !!editing || !draft;
        if (!draft) return;
        const saved = hasPreset(presets, draft);
        presetButton.textContent = saved ? `★ ${t('popup_preset_saved')}` : `☆ ${t('popup_preset_save')}`;
        presetButton.disabled = saved;
    };
    presetButton.addEventListener('click', async () => {
        const draft = presetDraft();
        if (!draft) return;
        presets = savePreset(presets, draft);
        await savePresets(presets);
        syncPreset();
    });

    const renderTasks = () => {
        taskSelect.replaceChildren(el('option', { value: '', text: t('popup_task_none') }));
        const tasks = projectFor(projectId)?.tasks ?? [];
        for (const task of tasks) taskSelect.append(el('option', { value: task.id, text: task.name }));
        taskSelect.value = taskId;
        if (taskSelect.value !== taskId) taskId = '';
        taskSelect.disabled = !projectId || tasks.length === 0;
        syncPreset();
        syncSubmit();
    };
    taskSelect.addEventListener('change', () => {
        taskId = taskSelect.value;
        syncPreset();
    });

    const picker = projectPicker({
        projects: ranked.map((s) => s.project),
        suggested,
        value: projectId,
        onChange: (id) => {
            projectId = id;
            taskId = suggested.find((s) => s.project.id === id)?.taskId ?? '';
            renderTasks();
        },
        onCreate: () => openInTab(`${workspace()}/projects/create`),
    });

    const close = () => {
        if (isWindow) {
            void call({ type: 'issue:pending:clear' }).finally(() => window.close());
            return;
        }
        formOpen = false;
        editing = null;
        render();
    };

    submit.addEventListener('click', async () => {
        if (!projectId) return;
        const checked = durationToSave({
            typed: duration.value,
            opened: openedDuration,
            mode: !editing ? 'new' : editing.timer_started_at ? 'running' : 'stopped',
            today: date.value === today(),
        });
        if (!checked.ok) {
            error.textContent = t('popup_error_duration');
            return;
        }
        const { minutes } = checked;
        const taskIdOrNull = taskId || null;
        submit.disabled = true;
        if (!editing && minutes === null) submitLabel.textContent = t('popup_starting');
        try {
            let entry: Entry | null;
            if (editing) {
                entry = await call<Entry>({ type: 'entry:update', id: editing.id, projectId, taskId: taskIdOrNull, notes: notes.value, date: date.value, minutes });
            } else if (minutes !== null) {
                entry = await call<Entry>({ type: 'entry:add', issue: from, projectId, taskId: taskIdOrNull, date: date.value, minutes, notes: notes.value });
            } else {
                entry = await call<Entry>({ type: 'timer:start', issue: from, projectId, taskId: taskIdOrNull, notes: notes.value });
            }
            if (isWindow) {
                window.close();
                return;
            }
            issue = null;
            showEntry(entry);
            await reload();
            errorMessage = '';
            closeOverlays();
            render();
        } catch (e) {
            error.textContent = errorText(e);
            submit.disabled = false;
            syncSubmit();
        }
    });

    const actions = el('div', { class: 'sheet-actions' });
    if (editing && !editing.timer_started_at) {
        const id = editing.id;
        const remove = el('button', { type: 'button', class: 'link danger sheet-delete', text: t('popup_delete') });
        // Two clicks and no dialog: the first only asks.
        let armed = false;
        remove.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                remove.textContent = t('popup_delete_confirm');
                return;
            }
            void act(() => call({ type: 'entry:delete', id }), error, remove);
        });
        actions.append(remove);
    }
    const cancel = el('button', { type: 'button', class: 'btn-outline', text: t('popup_cancel') });
    cancel.addEventListener('click', close);
    actions.append(cancel, submit);

    renderTasks();

    const card = el('div', { class: 'sheet' }, [
        el('p', { class: 'sheet-title', text: editing ? t('popup_edit_entry') : t('popup_new_entry') }),
        picker.el,
        taskSelect,
        presetButton,
        el('div', { class: 'sheet-row' }, [date, editing?.timer_started_at ? el('span', { class: 'sheet-dot', title: t('popup_timer_running') }) : '', duration]),
        notes,
        notice,
        error,
        actions,
    ]);
    card.addEventListener('keydown', (e) => {
        if (!isSaveShortcut(e, apple)) return;
        e.preventDefault();
        if (!submit.disabled) submit.click();
    });
    const overlay = el('div', { class: 'sheet-overlay' }, [card]);
    // click-away closes the sheet; in the detached window the sheet is the point of the window
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !isWindow) close();
    });
    queueMicrotask(() => {
        autosize();
        // Land in the project search, so a new timer is "＋, type, Enter"; a
        // suggested project is already the answer, so leave it and land on the notes.
        if (!projectId) picker.open();
        else if (!editing && date.value !== today()) duration.focus();
        else if (!editing) notes.focus();
    });
    return overlay;
}

function presetRow(row: PresetRow, redraw: () => void, error: HTMLElement): HTMLElement {
    const wrap = el('div', { class: `preset-row${row.missing ? ' missing' : ''}` });
    if (renaming === row.preset.id) {
        const input = el('input', { type: 'text', class: 'preset-rename', 'aria-label': t('popup_preset_rename'), spellcheck: 'false' });
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
                e.stopPropagation();
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
    ]);
    start.disabled = row.missing;
    start.addEventListener('click', () => {
        void act(() => call<Entry>({ type: 'timer:start', issue: null, projectId: row.preset.project_id, taskId: row.preset.task_id || null, notes: '' }).then(showEntry), error, start);
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
        const rename = el('button', { type: 'button', class: 'preset-icon', title: t('popup_preset_rename') }, [svg('icon-pencil', 11, ICON_PENCIL)]);
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

/** The ☆ popout: search, start, rename, delete. Rows redraw in place so the search keeps its focus. */
function presetsPopout(): HTMLElement {
    const error = el('p', { class: 'error' });
    const search = el('input', { type: 'text', class: 'preset-search', placeholder: t('popup_presets_search'), autocomplete: 'off', spellcheck: 'false' });
    search.value = presetQuery;
    const rows = el('div', { class: 'preset-rows' });
    const draw = () => {
        rows.replaceChildren();
        const all = presetRows(presetsFor(presets, workspace()), state.projects);
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
    return el('div', { class: 'presets' }, [el('div', { class: 'pref-group presets-title', text: t('popup_presets') }), search, rows, error]);
}

/** The ⚙ popout, as the desktop's: who is signed in, two tabs of preferences, the links, the build line. */
function settingsPopout(): HTMLElement {
    const panel = el('div', { class: 'settings' });
    if (settings.user) {
        panel.append(el('div', { class: 'settings-user' }, [el('strong', { text: settings.user.name }), el('span', { class: 'muted', text: settings.user.email })]), el('hr', { class: 'sep' }));
    }

    const tabs = el('div', { class: 'pref-tabs', role: 'tablist' });
    for (const [tab, label] of [
        ['settings', t('popup_settings')],
        ['shortcuts', t('options_shortcuts_heading')],
    ] as const) {
        const button = el('button', { type: 'button', class: `pref-tab${settingsTab === tab ? ' selected' : ''}`, role: 'tab', 'aria-selected': String(settingsTab === tab), text: label });
        button.addEventListener('click', () => {
            settingsTab = tab;
            render();
        });
        tabs.append(button);
    }
    panel.append(tabs);

    if (settingsTab === 'settings') {
        const appearance = el('select', { class: 'pref-select' });
        for (const [value, label] of [
            ['system', t('settings_system')],
            ['dark', t('settings_dark')],
            ['light', t('settings_light')],
        ] as const) {
            appearance.append(el('option', { value, text: label }));
        }
        appearance.value = settings.appearance;
        appearance.addEventListener('change', async () => {
            settings = await saveSettings({ appearance: appearance.value as Settings['appearance'] });
            applyTheme();
        });

        const idleEnabled = el('input', { type: 'checkbox' });
        idleEnabled.checked = settings.idleEnabled;
        const idleMinutes = el('input', { type: 'number', min: '1', max: '120', class: 'pref-num' });
        idleMinutes.value = String(settings.idleMinutes);
        idleMinutes.disabled = !settings.idleEnabled;
        const saveIdle = async () => {
            const value = Math.min(120, Math.max(1, Math.round(Number(idleMinutes.value) || 10)));
            idleMinutes.value = String(value);
            idleMinutes.disabled = !idleEnabled.checked;
            settings = await saveSettings({ idleEnabled: idleEnabled.checked, idleMinutes: value });
        };
        idleEnabled.addEventListener('change', () => void saveIdle());
        idleMinutes.addEventListener('change', () => void saveIdle());

        panel.append(
            el('div', { class: 'pref-panel', role: 'tabpanel' }, [
                el('label', { class: 'pref-row' }, [el('span', { text: t('settings_appearance') }), appearance]),
                el('label', { class: 'pref-row' }, [
                    el('span', { class: 'pref-idle-label' }, [idleEnabled, ` ${t('options_idle_after')}`]),
                    el('span', { class: 'pref-idle' }, [idleMinutes, ` ${t('settings_min')}`]),
                ]),
            ]),
        );
    } else {
        // Chrome owns the bindings (board #268): the rows show them, the link is where they change.
        const rows = el('div', { class: 'pref-panel pref-shortcuts', role: 'tabpanel' });
        void chrome.commands.getAll().then((commands) => {
            for (const command of commands) {
                rows.append(
                    el('div', { class: 'pref-row' }, [
                        el('span', { class: 'pref-shortcut-label', text: command.description ?? command.name ?? '' }),
                        el('span', { class: `shortcut-record${command.shortcut ? ' set' : ''}`, text: command.shortcut || t('options_shortcut_unbound') }),
                    ]),
                );
            }
            const change = el('button', { type: 'button', class: 'link', text: t('options_shortcuts_open') });
            change.addEventListener('click', () => openInTab('chrome://extensions/shortcuts'));
            rows.append(change);
        });
        panel.append(rows);
    }

    const open = el('button', { type: 'button', class: 'link', text: t('settings_open_browser') });
    open.addEventListener('click', () => openInTab(workspace()));
    const more = el('button', { type: 'button', class: 'link', text: t('settings_more') });
    more.addEventListener('click', () => void chrome.runtime.openOptionsPage());
    const disconnect = el('button', { type: 'button', class: 'link', text: t('settings_disconnect') });
    disconnect.addEventListener('click', async () => {
        // the socket is authorised by the token, so the broadcast block goes with it (board #279)
        settings = await saveSettings({ token: '', user: null, broadcast: null });
        closeOverlays();
        await reload();
        render();
    });
    panel.append(
        el('hr', { class: 'sep' }),
        open,
        more,
        disconnect,
        el('hr', { class: 'sep' }),
        el('div', { class: 'build-row' }, [el('span', { class: 'build-line', text: `Zebu for Chrome v${chrome.runtime.getManifest().version}` })]),
    );
    return panel;
}

// ---- screens -------------------------------------------------------------------

/** The desktop's connect screen: the workspace's name before .zebu.work. The device flow itself runs on the options page, which stays open while you approve. */
function renderConnect(): void {
    destroyInsights();
    const input = el('input', { type: 'text', autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: t('options_workspace_placeholder') });
    input.value = settings.workspace ? workspaceName(settings.workspace) : '';
    const error = el('p', { class: 'error status', text: errorMessage });
    const login = el('button', { type: 'button', class: 'btn-primary', text: t('popup_login') });
    const go = () => {
        const name = workspaceName(input.value);
        if (!isWorkspaceName(name)) {
            // a well-formed name that is refused can only be the central site's
            error.textContent = t(/^[a-z0-9][a-z0-9-]*$/i.test(name) ? 'options_error_central' : 'options_error_workspace');
            return;
        }
        openInTab(chrome.runtime.getURL(`options.html?${new URLSearchParams({ workspace: name, connect: '1' })}`));
    };
    login.addEventListener('click', go);
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') go();
    });
    app.replaceChildren(
        el('div', { class: 'connect' }, [
            el('div', { class: 'connect-logo', text: 'Zebu' }),
            el('label', { class: 'field' }, [
                el('span', { class: 'field-label', text: t('popup_workspace') }),
                el('span', { class: 'field-row' }, [input, el('span', { class: 'field-suffix', text: `.${DEFAULT_DOMAIN}` })]),
                el('span', { class: 'hint', text: t('options_workspace_hint') }),
            ]),
            login,
            error,
        ]),
    );
    queueMicrotask(() => input.focus());
}

const destroyInsights = () => {
    insights?.destroy();
    insights = null;
};

function renderMain(): void {
    window.clearInterval(tick);
    tickers = [];
    const main = el('div', { class: `main${formOpen || confirmNewDay ? ' has-sheet' : ''}` }, [header()]);
    if (view === 'insights') {
        if (!insights) insights = insightsPanel({ running: () => state.running, now });
        main.append(insights.el);
    } else {
        destroyInsights();
        main.append(weekStrip(), resumeBar(), runningElsewhere(), entriesList(), footer());
        if (confirmNewDay) main.append(newDaySheet());
        if (formOpen) main.append(entrySheet());
        if (presetsOpen && !sheet.weekLocked) {
            const backdrop = el('div', { class: 'popover-backdrop' });
            backdrop.addEventListener('click', () => {
                presetsOpen = false;
                render();
            });
            main.append(backdrop, presetsPopout());
        }
        if (settingsOpen) {
            const backdrop = el('div', { class: 'popover-backdrop' });
            backdrop.addEventListener('click', () => {
                settingsOpen = false;
                render();
            });
            main.append(backdrop, settingsPopout());
        }
    }
    app.replaceChildren(main);
    if (tickers.length) tick = window.setInterval(() => tickers.forEach((fn) => fn()), 10_000);
}

function render(): void {
    watchTimer();
    if (!state.connected) return renderConnect();
    renderMain();
}

// Escape closes whatever is on top: the presets, the settings, the sheet.
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (presetsOpen) presetsOpen = false;
    else if (settingsOpen) settingsOpen = false;
    else if (confirmNewDay) confirmNewDay = false;
    else if (formOpen && !isWindow) {
        formOpen = false;
        editing = null;
    } else return;
    e.preventDefault();
    render();
});

// ---- keeping up with the server ------------------------------------------------

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
            const changed =
                next.connected !== state.connected || next.running?.id !== state.running?.id || next.running?.timer_started_at !== state.running?.timer_started_at || next.live !== state.live;
            state = next;
            if (!changed) return watchTimer();
            if (state.connected) await loadSheet();
            last = lastTimerFor(await getLastTimer(), workspace());
            // Never redraw over the sheet: it holds what the user is half way through typing.
            if (formOpen) watchTimer();
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
export function nextWatchIn(state: Pick<State, 'running' | 'downUntil' | 'live'>, now: number): number {
    if (isHeld(state.downUntil, now)) return Math.max(state.downUntil! - now, POLL.idle);
    // pushed changes arrive on their own (board #279); the pulse is only a backstop
    if (state.live) return POLL.live;

    return state.running ? POLL.running : POLL.idle;
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) watchTimer();
    else window.clearTimeout(watch);
});

(async () => {
    settings = await getSettings();
    applyTheme();
    try {
        state = await call<State>({ type: 'state:get' });
        // The toolbar popup is handed no issue, but it has the page it was
        // opened over: title, link and selection prefill a new timer.
        issue = idleEntry ? null : isWindow ? await call<Issue | null>({ type: 'issue:pending:get' }) : await capturePage();
        if (idleEntry) selectedDate = idleEntry.date;
        if (state.connected) await loadSheet();
        await loadLocal();
        // The detached window is the sheet for one issue — unless that very
        // issue is what is already running, in which case the day view shows
        // it so it can be stopped.
        if (isWindow && state.connected && !(issue && state.running && entryMatchesIssue(state.running.notes, issue))) formOpen = true;
    } catch (e) {
        errorMessage = errorText(e);
    }
    render();
})();
