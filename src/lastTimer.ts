// The last actively managed timer, remembered across popup openings for a
// one-click resume when nothing runs (board #268), as the desktop's
// `zebu.lastTimer`. The service worker writes it from the timesheet's
// `active` entry — the server's own answer to "the current timer" — so the
// popup and the keyboard shortcut resume the same work.
import type { Entry } from './types';

export interface LastTimer {
    entry_id: string;
    project_id: string;
    task_id: string | null;
    notes: string | null;
    project: string | null;
    task: string | null;
    date: string;
    /** The timer only means something on the workspace it came from. */
    workspace: string;
}

export const lastTimerFrom = (entry: Entry, workspace: string): LastTimer => ({
    entry_id: entry.id,
    project_id: entry.project_id,
    task_id: entry.task_id,
    notes: entry.notes,
    project: entry.project,
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
        task: strOrNull(s.task),
        date: str(s.date),
        workspace: str(s.workspace),
    };
    if (!last.entry_id || !last.project_id || !last.date || !workspace || last.workspace !== workspace) return null;
    return last;
};
