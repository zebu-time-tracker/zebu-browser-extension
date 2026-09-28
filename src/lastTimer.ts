// The last actively managed timer, remembered across popup openings for a
// one-click resume when nothing runs (board #268), as the desktop's
// `zebu.lastTimer`. The service worker writes it from the timesheet's
// `active` entry — the server's own answer to "the current timer" — so the
// popup and the keyboard shortcut resume the same work.
import type { Entry, ProjectOption } from './types';

export interface LastTimer {
    entry_id: string;
    project_id: string;
    task_id: string | null;
    notes: string | null;
    project: string | null;
    /** The project's client, when the project list knew it. Stored values from before board #411 have none. */
    client: string | null;
    task: string | null;
    date: string;
    /** The timer only means something on the workspace it came from. */
    workspace: string;
}

/** The entry carries no client; the timesheet's project list does. */
export const lastTimerFrom = (entry: Entry, workspace: string, projects: ProjectOption[] = []): LastTimer => ({
    entry_id: entry.id,
    project_id: entry.project_id,
    task_id: entry.task_id,
    notes: entry.notes,
    project: entry.project,
    client: projects.find((p) => p.id === entry.project_id)?.client ?? null,
    task: entry.task,
    date: entry.date,
    workspace,
});

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The stored memory, if it is one and belongs to `workspace`. A timer
 * remembered on another workspace (a dev server's demo data, say) would offer
 * to resume a project that does not exist here.
 */
export const lastTimerFor = (stored: unknown, workspace: string): LastTimer | null => {
    if (!stored || typeof stored !== 'object') return null;
    const s = stored as Record<string, unknown>;
    const last: LastTimer = {
        entry_id: str(s.entry_id),
        project_id: str(s.project_id),
        task_id: strOrNull(s.task_id),
        notes: strOrNull(s.notes),
        project: strOrNull(s.project),
        client: strOrNull(s.client),
        task: strOrNull(s.task),
        date: str(s.date),
        workspace: str(s.workspace),
    };
    if (!last.entry_id || !last.project_id || !last.date || !workspace || last.workspace !== workspace) return null;
    return last;
};

/**
 * What the ▶ bar offers for `last` on `today`. The same day resumes the
 * entry; an earlier one starts a new timer today, so saying "Resume" would
 * promise the wrong thing (board #361).
 */
export const resumeLabelKey = (last: Pick<LastTimer, 'date'>, today: string): 'popup_resume' | 'popup_start_new_timer' =>
    last.date === today ? 'popup_resume' : 'popup_start_new_timer';

/**
 * The bar's project line, "Project · Task" (board #411); the client sits
 * above it on its own line, as on an entry row.
 */
/**
 * Whether the day on show lists nothing but the last timer's own entry: the
 * ▶ bar would then repeat the one row under it (board #450, as the desktop).
 */
export const lastTimerIsOnlyEntry = (last: Pick<LastTimer, 'entry_id' | 'date'>, dayEntries: Pick<Entry, 'id'>[], shownDate: string): boolean =>
    last.date === shownDate && dayEntries.length === 1 && dayEntries[0].id === last.entry_id;

export const resumeWork = (last: Pick<LastTimer, 'project' | 'task'>): string => [last.project, last.task].filter(Boolean).join(' · ');
