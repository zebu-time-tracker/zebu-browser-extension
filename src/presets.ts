// Saved starting points for a timer: a project and a task the user starts
// often, behind the ☆ beside "New timer" (board #268). The same rules as the
// desktop's src/presets.ts, so a preset means the same thing in both.
//
// Stored in chrome.storage.local (`presets`), next to the settings and the
// last-timer memory, rather than on the server: a preset is a personal
// shortcut — two ids and a name — and nothing else in the suite reads it.
//
// A preset's ids only mean something on the workspace it was saved from, so
// each one records its workspace and the list is filtered by the connected
// one. Presets of other workspaces are kept: reconnecting brings them back.
import { fuzzyFilter } from './fuzzy';
import type { ProjectOption } from './types';

export interface Preset {
    id: string;
    /** What the row shows: the project and task it was saved from, until renamed. */
    name: string;
    project_id: string;
    /** '' is "no task", the same empty value the form's select uses. */
    task_id: string;
    /** The workspace whose ids these are. */
    workspace: string;
}

/** A preset before it has an id: what the form describes right now. */
export type PresetDraft = Omit<Preset, 'id'>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Whatever came out of storage, made safe to render: anything that is not an
 * object with an id, a name and a project is dropped, so a future shape can
 * never leave a row half-defined.
 */
export const readPresets = (stored: unknown): Preset[] => {
    if (!Array.isArray(stored)) return [];
    return stored
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({
            id: str(p.id),
            name: str(p.name).trim(),
            project_id: str(p.project_id),
            task_id: str(p.task_id),
            workspace: str(p.workspace),
        }))
        .filter((p) => p.id && p.name && p.project_id);
};

/** The presets that belong to `workspace` — a preset's ids mean nothing anywhere else. */
export const presetsFor = (presets: Preset[], workspace: string): Preset[] => presets.filter((p) => p.workspace === workspace);

/** Whether this starting point is already saved: the same project and task, on the same workspace. */
export const hasPreset = (presets: Preset[], draft: PresetDraft): boolean =>
    presets.some((p) => p.workspace === draft.workspace && p.project_id === draft.project_id && p.task_id === draft.task_id);

/** A fresh id; `crypto.randomUUID` where there is one, and something unique enough where there isn't. */
export const newPresetId = (): string => globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * `draft` added to the list. The same project and task on the same workspace
 * *is* the same starting point, so saving it twice leaves the list alone —
 * which is also what lets the form say "saved" instead of offering again.
 */
export const savePreset = (presets: Preset[], draft: PresetDraft, id: () => string = newPresetId): Preset[] => {
    const name = draft.name.trim();
    if (!name || !draft.project_id || hasPreset(presets, draft)) return presets;
    return [...presets, { id: id(), name, project_id: draft.project_id, task_id: draft.task_id, workspace: draft.workspace }];
};

/** A renamed preset. An empty name is not a name: the row keeps the one it had. */
export const renamePreset = (presets: Preset[], id: string, name: string): Preset[] => {
    const next = name.trim();
    if (!next) return presets;
    return presets.map((p) => (p.id === id ? { ...p, name: next } : p));
};

export const removePreset = (presets: Preset[], id: string): Preset[] => presets.filter((p) => p.id !== id);

/** The name a preset is saved under before it is renamed: the project, and the task when there is one. */
export const defaultPresetName = (project: ProjectOption | null | undefined, taskId: string): string => {
    if (!project) return '';
    const task = project.tasks.find((t) => t.id === taskId);
    return task ? `${project.name} · ${task.name}` : project.name;
};

export interface PresetRow {
    preset: Preset;
    /** Client, code, project and task as they read *now*, from the live project list. */
    subtitle: string;
    /** The project has gone from this workspace: the row says so and cannot be started. */
    missing: boolean;
}

/**
 * The presets as rows to render. The name is the user's, but everything under
 * it is resolved against the live project list every time — so a renamed
 * project shows its new name, and an archived one shows as missing instead of
 * starting a timer against an id the server would refuse.
 */
export const presetRows = (presets: Preset[], projects: ProjectOption[]): PresetRow[] =>
    presets.map((preset) => {
        const project = projects.find((p) => p.id === preset.project_id);
        if (!project) return { preset, subtitle: '', missing: true };
        const task = project.tasks.find((t) => t.id === preset.task_id);
        const subtitle = [project.client, project.code ? `${project.code}: ${project.name}` : project.name, task?.name].filter(Boolean).join(' · ');
        return { preset, subtitle, missing: false };
    });

/** The rows a search matches. Both halves of a row are searchable: the user's name and what it resolves to. */
export const filterPresets = (rows: PresetRow[], query: string): PresetRow[] => fuzzyFilter(rows, query, (r) => `${r.preset.name} ${r.subtitle}`);
