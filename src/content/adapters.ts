// One adapter per tracker: given the page URL and DOM, say what issue this
// is and where a "Track time" button would sit. Selectors on these sites
// change often, so every adapter leans on the URL for identity and on
// document.title as a fallback for the issue title — if the anchor selector
// breaks, the button simply floats instead of disappearing.
//
// Adding a tracker = adding one object to ADAPTERS (and its host to the
// manifest's content_scripts.matches, or letting users add it as a custom
// site from the options page).
import type { Issue } from '../types';

export interface Adapter {
    id: string;
    label: string;
    /** Hostname test (custom self-hosted origins bypass this via settings). */
    hosts: RegExp;
    detect(url: URL, doc: Document): Issue | null;
    /** Where to put the button; null → floating button. */
    anchor?(doc: Document): Element | null;
}

const text = (doc: Document, selectors: string[]): string => {
    for (const selector of selectors) {
        const el = doc.querySelector<HTMLElement>(selector);
        const value = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el?.textContent) ?? '';
        if (value.trim()) return value.trim().replace(/\s+/g, ' ');
    }
    return '';
};

const first = (doc: Document, selectors: string[]): Element | null => {
    for (const selector of selectors) {
        const el = doc.querySelector(selector);
        if (el) return el;
    }
    return null;
};

/** document.title minus the site's suffix pattern. */
const fromTitle = (doc: Document, strip: RegExp): string => doc.title.replace(strip, '').trim();

const issue = (partial: Omit<Issue, 'containerHints'> & { containerHints?: string[] }): Issue => ({
    containerHints: [],
    ...partial,
    title: partial.title || partial.identifier || partial.container,
});

export const ADAPTERS: Adapter[] = [
    {
        id: 'github',
        label: 'GitHub',
        hosts: /(^|\.)github\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull|discussions)\/(\d+)/);
            if (!m) return null;
            const [, owner, repo, kind, number] = m;
            const title =
                text(doc, ['h1 bdi.js-issue-title', 'h1 .js-issue-title', '[data-testid="issue-title"]', '[data-component="PH_Title"] h1', '.gh-header-title .js-issue-title']) ||
                fromTitle(doc, /\s*·\s*(Issue|Pull Request|Discussion)\s*#\d+.*$/i).replace(/^\[?[^\]]*\]?\s*/, (s) => (s.includes(']') ? '' : s));
            return issue({
                site: 'github',
                key: `github:${owner}/${repo}#${number}`,
                container: `${owner}/${repo}`,
                containerHints: [repo, owner],
                identifier: `#${number}`,
                title: title.replace(/\s*#\d+\s*$/, ''),
                url: `${url.origin}/${owner}/${repo}/${kind}/${number}`,
            });
        },
        anchor: (doc) => first(doc, ['.gh-header-actions', '[data-testid="issue-header"] [data-testid="issue-metadata-sticky"]', '.gh-header-show .gh-header-actions']),
    },
    {
        id: 'gitlab',
        label: 'GitLab',
        hosts: /(^|\.)gitlab\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/(.+?)\/-\/(issues|merge_requests|work_items|epics)\/(\d+)/);
            if (!m) return null;
            const [, project, kind, number] = m;
            const title = text(doc, ['h1.title', '[data-testid="issue-title"]', '[data-testid="work-item-title"]', '.detail-page-description .title']) || fromTitle(doc, /\s*\(\S+\)\s*·\s*(Issues|Merge requests|Epics)\s*·.*$/i);
            const prefix = kind === 'merge_requests' ? '!' : kind === 'epics' ? '&' : '#';
            return issue({
                site: 'gitlab',
                key: `gitlab:${project}${prefix}${number}`,
                container: project,
                containerHints: project.split('/').reverse(),
                identifier: `${prefix}${number}`,
                title: title.replace(/^(#|!|&)\d+\s*/, ''),
                url: `${url.origin}/${project}/-/${kind}/${number}`,
            });
        },
        anchor: (doc) => first(doc, ['.detail-page-header-actions', '.issue-sticky-header .gl-display-flex', '.merge-request-details .detail-page-header-actions']),
    },
    {
        id: 'jira',
        label: 'Jira',
        hosts: /(^|\.)atlassian\.net$/,
        detect(url, doc) {
            const key = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1] ?? url.searchParams.get('selectedIssue') ?? '';
            if (!key) return null;
            const projectKey = key.split('-')[0];
            const site = url.hostname.split('.')[0];
            const title =
                text(doc, [
                    '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
                    '[data-testid="issue.views.issue-base.foundation.summary.heading.writeable"] h1',
                    '#summary-val',
                    'h1[data-test-id*="summary"]',
                ]) || fromTitle(doc, /^\[[A-Z0-9_-]+\]\s*|\s*-\s*Jira.*$/g);
            const projectName = text(doc, ['[data-testid="issue.views.issue-base.foundation.breadcrumbs.breadcrumb-current-issue-container"] a', 'nav[aria-label="Breadcrumbs"] a[href*="/projects/"], nav[aria-label="Breadcrumbs"] a[href*="/browse/"]']);
            return issue({
                site: 'jira',
                key: `jira:${site}:${key}`,
                container: projectName || projectKey,
                containerHints: [projectKey, site],
                identifier: key,
                title,
                url: `${url.origin}/browse/${key}`,
            });
        },
        anchor: (doc) => first(doc, ['[data-testid="issue.views.issue-base.foundation.quick-add.quick-add-items-compact"]', '[data-testid="issue-view-foundation.quick-add"]', '[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"]']),
    },
    {
        id: 'linear',
        label: 'Linear',
        hosts: /(^|\.)linear\.app$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/([^/]+)\/issue\/([A-Z0-9]+-\d+)(?:\/([^/]*))?/);
            if (!m) return null;
            const [, workspace, key, slug] = m;
            const team = key.split('-')[0];
            const title = text(doc, ['[data-testid="issue-title"]', 'h1[contenteditable]', '[aria-label="Issue title"]', 'main h1']) || fromTitle(doc, /\s*[-–]\s*Linear.*$/i).replace(new RegExp(`^${key}\\s*`), '') || (slug ?? '').replace(/-/g, ' ');
            return issue({
                site: 'linear',
                key: `linear:${workspace}:${key}`,
                container: team,
                containerHints: [workspace],
                identifier: key,
                title,
                url: `${url.origin}/${workspace}/issue/${key}`,
            });
        },
        anchor: (doc) => first(doc, ['[data-testid="issue-header-actions"]', 'main header']),
    },
    {
        id: 'asana',
        label: 'Asana',
        hosts: /(^|\.)asana\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/\/0\/(\d+)\/(\d+)/) ?? url.pathname.match(/\/(?:task|item)\/(\d+)/);
            if (!m) return null;
            const taskId = m[2] ?? m[1];
            const title = text(doc, ['textarea.TaskName-input', '.TitleInput-textarea', 'textarea[aria-label="Task Name"]', '.TaskPaneTitle textarea']) || fromTitle(doc, /\s*[-–]\s*Asana.*$/i);
            const project = text(doc, ['.TaskProjectToken-projectName', '.TaskProjects .TaskProjectToken', '.TopbarPageHeaderStructure-titleRow h1', '.PageHeaderStructure-title']);
            return issue({
                site: 'asana',
                key: `asana:${taskId}`,
                container: project || fromTitle(doc, /\s*[-–]\s*Asana.*$/i),
                containerHints: [],
                identifier: '',
                title,
                url: `${url.origin}/0/0/${taskId}/f`,
            });
        },
        anchor: (doc) => first(doc, ['.TaskPaneToolbar', '.TaskPaneToolbar-actionsContainer', '.TaskPane-header']),
    },
    {
        id: 'trello',
        label: 'Trello',
        hosts: /(^|\.)trello\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/c\/([A-Za-z0-9]+)(?:\/(\d+)-([^/]+))?/);
            if (!m) return null;
            const [, cardId, number, slug] = m;
            const title = text(doc, ['[data-testid="card-back-title-input"]', 'h2.card-detail-title-assist', '.js-title-helper', '.window-title h2']) || fromTitle(doc, /\s*on\s+.*?\s*[|]\s*Trello.*$/i) || (slug ?? '').replace(/-/g, ' ');
            const board = text(doc, ['[data-testid="board-name-display"]', '.board-header-btn-name', 'h1.board-header-btn-text']) || doc.title.match(/\son\s+(.+?)\s*[|]\s*Trello/i)?.[1] || '';
            return issue({
                site: 'trello',
                key: `trello:${cardId}`,
                container: board,
                containerHints: [],
                identifier: number ? `#${number}` : '',
                title,
                url: `${url.origin}/c/${cardId}`,
            });
        },
        anchor: (doc) => first(doc, ['[data-testid="card-back-actions"]', '.window-sidebar .window-module:first-child', '.window-header']),
    },
    {
        id: 'bitbucket',
        label: 'Bitbucket',
        hosts: /(^|\.)bitbucket\.org$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull-requests)\/(\d+)/);
            if (!m) return null;
            const [, workspace, repo, kind, number] = m;
            const title = text(doc, ['#issue-title', 'h1[data-qa="pr-header-title"]', '[data-qa="pr-header-title"] h1', 'main h1']) || fromTitle(doc, /\s*[-–—]\s*Bitbucket.*$/i).replace(/^(Issue|Pull Request)\s*#\d+:?\s*/i, '');
            return issue({
                site: 'bitbucket',
                key: `bitbucket:${workspace}/${repo}#${number}`,
                container: `${workspace}/${repo}`,
                containerHints: [repo, workspace],
                identifier: `#${number}`,
                title,
                url: `${url.origin}/${workspace}/${repo}/${kind}/${number}`,
            });
        },
        anchor: (doc) => first(doc, ['[data-qa="pr-header-actions"]', '.issue-header .aui-toolbar2-primary', 'main header']),
    },
    {
        id: 'clickup',
        label: 'ClickUp',
        hosts: /(^|\.)clickup\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/\/t\/([A-Za-z0-9-]+)/);
            if (!m) return null;
            const taskId = m[1];
            const title = text(doc, ['[data-test="task-title__title-overlay"]', '.task-name__overlay', '.cu-task-title__overlay', 'h1.cu-task-title']) || fromTitle(doc, /\s*[|]\s*ClickUp.*$/i);
            const crumbs = Array.from(doc.querySelectorAll<HTMLElement>('.breadcrumbs__link, [data-test="breadcrumbs__link"], .cu-task-breadcrumbs__link')).map((e) => e.textContent?.trim() ?? '').filter(Boolean);
            return issue({
                site: 'clickup',
                key: `clickup:${taskId}`,
                container: crumbs.at(-1) ?? '',
                containerHints: crumbs.slice(0, -1).reverse(),
                identifier: '',
                title,
                url: `${url.origin}/t/${taskId}`,
            });
        },
        anchor: (doc) => first(doc, ['.cu-task-view-header__actions', '[data-test="task-view-header__actions"]', '.task-container__header']),
    },
    {
        id: 'basecamp',
        label: 'Basecamp',
        hosts: /(^|\.)basecamp\.com$/,
        detect(url, doc) {
            const m = url.pathname.match(/^\/(\d+)\/buckets\/(\d+)\/(todos|card_tables\/cards|messages)\/(\d+)/);
            if (!m) return null;
            const [, account, bucket, kind, id] = m;
            const title = text(doc, ['h1.perma-title', '.todo__content .todo__title', 'h1.recording-title', 'main h1']) || fromTitle(doc, /\s*[-–—]\s*.*?Basecamp.*$/i);
            const project = text(doc, ['.project-header__title', '.breadcrumbs a[href*="/projects/"]', 'nav .project__name']);
            return issue({
                site: 'basecamp',
                key: `basecamp:${account}/${bucket}/${id}`,
                container: project,
                containerHints: [],
                identifier: '',
                title,
                url: `${url.origin}/${account}/buckets/${bucket}/${kind}/${id}`,
            });
        },
        anchor: (doc) => first(doc, ['.perma-toolbar', '.recording-toolbar', 'main header']),
    },
];

export function adapterFor(host: string, custom: { origin: string; adapter: string }[] = [], origin = ''): Adapter | null {
    const customMatch = custom.find((c) => c.origin === origin);
    if (customMatch) return ADAPTERS.find((a) => a.id === customMatch.adapter) ?? null;
    return ADAPTERS.find((a) => a.hosts.test(host)) ?? null;
}
