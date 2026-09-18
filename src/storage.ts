// Typed wrappers over chrome.storage. Settings and learned mappings live in
// `local` (survive restarts); the pending issue handed from a page to the
// timer window lives in `session` (cleared when the browser closes).
import { DEFAULT_SETTINGS, type Issue, type Mappings, type Settings } from './types';
import { migrateWorkspaceOrigin } from './workspace';

export async function getSettings(): Promise<Settings> {
    const { settings } = await chrome.storage.local.get('settings');
    const merged: Settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    // Workspaces moved from {sub}.app.zebu.work to {sub}.zebu.work; the token
    // is per workspace, so only the stored origin needs rewriting (board #270).
    const migrated = migrateWorkspaceOrigin(merged.workspace);
    if (migrated !== merged.workspace) {
        merged.workspace = migrated;
        await chrome.storage.local.set({ settings: merged });
    }
    return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
}

export async function getMappings(): Promise<Mappings> {
    const { mappings } = await chrome.storage.local.get('mappings');
    return mappings ?? {};
}

export async function saveMappings(mappings: Mappings): Promise<void> {
    await chrome.storage.local.set({ mappings });
}

export async function setPendingIssue(issue: Issue | null): Promise<void> {
    if (issue) await chrome.storage.session.set({ pendingIssue: issue });
    else await chrome.storage.session.remove('pendingIssue');
}

export async function getPendingIssue(): Promise<Issue | null> {
    const { pendingIssue } = await chrome.storage.session.get('pendingIssue');
    return pendingIssue ?? null;
}
