// Typed wrappers over chrome.storage. Settings and learned mappings live in
// `local` (survive restarts); the pending issue handed from a page to the
// timer window lives in `session` (cleared when the browser closes).
import type { LastTimer } from './lastTimer';
import { readPresets, type Preset } from './presets';
import { DEFAULT_SETTINGS, type Issue, type Mappings, type Settings } from './types';

export async function getSettings(): Promise<Settings> {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
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

// Saved starting points and the last timer (board #268), kept per workspace.
export async function getPresets(): Promise<Preset[]> {
    const { presets } = await chrome.storage.local.get('presets');
    return readPresets(presets);
}

export async function savePresets(presets: Preset[]): Promise<void> {
    await chrome.storage.local.set({ presets });
}

/** Whatever was remembered; lastTimerFor() decides whether it is usable here. */
export async function getLastTimer(): Promise<unknown> {
    const { lastTimer } = await chrome.storage.local.get('lastTimer');
    return lastTimer ?? null;
}

export async function setLastTimer(last: LastTimer): Promise<void> {
    await chrome.storage.local.set({ lastTimer: last });
}

export async function setPendingIssue(issue: Issue | null): Promise<void> {
    if (issue) await chrome.storage.session.set({ pendingIssue: issue });
    else await chrome.storage.session.remove('pendingIssue');
}

export async function getPendingIssue(): Promise<Issue | null> {
    const { pendingIssue } = await chrome.storage.session.get('pendingIssue');
    return pendingIssue ?? null;
}
