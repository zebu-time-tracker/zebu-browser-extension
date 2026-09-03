// Project suggestions for an issue: what you picked last time for this repo
// or board wins outright; otherwise the repo/board/project name is fuzzily
// matched against Zebu project and client names; recently used projects
// break ties. Pure functions — no chrome.* here — so they are unit-tested.
import type { Issue, Mappings, ProjectOption } from './types';

export interface Suggestion {
    project: ProjectOption;
    taskId: string | null;
    score: number;
    reason: 'remembered' | 'name' | 'recent';
}

/** Key under which a choice for this issue's container is remembered. */
export function mappingKey(issue: Pick<Issue, 'site' | 'container'>): string {
    return `${issue.site}:${normalize(issue.container)}`;
}

/** Lower-case, split camelCase / kebab / snake, strip noise. */
export function normalize(value: string): string {
    return value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_\-./:@]+/g, ' ')
        .replace(/[^\p{L}\p{N} ]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'app', 'web', 'api', 'main', 'dev', 'prod', 'project', 'projects', 'team', 'board', 'repo', 'issues', 'inc', 'gmbh', 'ltd', 'llc']);

export function tokens(value: string): string[] {
    return normalize(value)
        .split(' ')
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function bigrams(value: string): Set<string> {
    const s = normalize(value).replace(/ /g, '');
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
}

/** Sørensen–Dice on character bigrams: 0..1, tolerant of small spelling differences. */
export function dice(a: string, b: string): number {
    const A = bigrams(a);
    const B = bigrams(b);
    if (A.size === 0 || B.size === 0) return 0;
    let hits = 0;
    for (const g of A) if (B.has(g)) hits++;
    return (2 * hits) / (A.size + B.size);
}

/** Token overlap: share of the shorter side's tokens present in the other. */
export function tokenOverlap(a: string, b: string): number {
    const A = tokens(a);
    const B = new Set(tokens(b));
    if (A.length === 0 || B.size === 0) return 0;
    let hits = 0;
    for (const t of A) if (B.has(t) || [...B].some((x) => x.startsWith(t) || t.startsWith(x))) hits++;
    return hits / Math.min(A.length, B.size);
}

/** How well a project matches one name (repo, board, …), 0..1. */
export function nameScore(name: string, project: ProjectOption): number {
    const candidates = [project.name, project.client ?? '', `${project.client ?? ''} ${project.name}`].filter(Boolean);
    let best = 0;
    for (const candidate of candidates) {
        const score = Math.max(dice(name, candidate), 0.9 * tokenOverlap(name, candidate));
        if (score > best) best = score;
    }
    return best;
}

/**
 * Rank projects for an issue. Returns every project, best first, with the
 * score and the reason; callers show the top few as "Suggested" when their
 * score clears `threshold`.
 */
export function suggest(issue: Issue | null, projects: ProjectOption[], mappings: Mappings, recentProjectIds: string[] = [], threshold = 0.45): Suggestion[] {
    const remembered = issue ? mappings[mappingKey(issue)] : undefined;
    const names = issue ? [issue.container, ...issue.containerHints].filter(Boolean) : [];

    const ranked = projects.map((project): Suggestion => {
        if (remembered && remembered.projectId === project.id) {
            // Above any name score (max 1 + 0.05 recency) so memory always wins.
            return { project, taskId: remembered.taskId, score: 2, reason: 'remembered' };
        }

        let score = 0;
        for (const [i, name] of names.entries()) {
            // The primary container counts fully; hints (org, site name) a little less.
            const weight = i === 0 ? 1 : 0.85;
            score = Math.max(score, weight * nameScore(name, project));
        }

        const recentIndex = recentProjectIds.indexOf(project.id);
        const recency = recentIndex === -1 ? 0 : (recentProjectIds.length - recentIndex) / recentProjectIds.length;

        if (score >= threshold) return { project, taskId: null, score: score + recency * 0.05, reason: 'name' };
        return { project, taskId: null, score: recency * 0.4, reason: 'recent' };
    });

    return ranked.sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
}

/** Remember a choice so next time the same repo/board is instant. */
export function remember(mappings: Mappings, issue: Issue, projectId: string, taskId: string | null): Mappings {
    const key = mappingKey(issue);
    const previous = mappings[key];
    return {
        ...mappings,
        [key]: {
            projectId,
            taskId,
            count: previous && previous.projectId === projectId ? previous.count + 1 : 1,
            lastUsed: Date.now(),
        },
    };
}

/** The note a new timer starts with, from the issue. */
export function composeNotes(issue: Issue, format: 'identifier_title_url' | 'title_url' | 'title'): string {
    const head = issue.identifier && format === 'identifier_title_url' ? `${issue.identifier} ${issue.title}` : issue.title;
    return format === 'title' ? head : `${head}\n${issue.url}`;
}

/** Does a running entry belong to this issue? (Its notes carry the URL.) */
export function entryMatchesIssue(notes: string | null | undefined, issue: Issue): boolean {
    if (!notes) return false;
    const url = issue.url.replace(/[?#].*$/, '');
    return notes.includes(url) || (issue.identifier !== '' && notes.includes(issue.identifier) && notes.includes(issue.title.slice(0, 24)));
}
