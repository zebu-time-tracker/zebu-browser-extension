// Any page, seen from the toolbar popup or the context menu: the tab's title
// and link, and whatever the reader had selected. Trackers have their
// adapters (src/content/adapters.ts); this is for everything else — a
// client's site, a document, a ticket in a tool with no adapter — so a timer
// can still start with the page in its notes (board #266). Pure functions,
// unit-tested; the chrome.* calls that gather the context live in the popup
// and the service worker.
import type { Issue } from './types';

export interface PageContext {
    url: string;
    title: string;
    /** What the reader had selected when they asked, if anything. */
    selection?: string | null;
}

/** Whitespace collapsed, trimmed and capped: a selection can be a whole article. */
export function cleanSelection(value: string | null | undefined, max = 200): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The host without a leading www., or '' for anything that is not a web page. */
export function siteOf(url: string): string {
    try {
        const parsed = new URL(url);
        return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : '';
    } catch {
        return '';
    }
}

/**
 * An issue for a page no adapter knows. The site is the container, so a
 * project picked for it once is remembered for the whole site; the domain's
 * own name and the page title are hints for the name match. A selection
 * becomes the title: that is the description the reader asked for.
 */
export function pageIssue(page: PageContext): Issue | null {
    const host = siteOf(page.url);
    if (!host) return null;
    const parsed = new URL(page.url);
    const labels = host.split('.');
    const hints = labels.length > 1 ? labels.slice(0, -1).reverse() : []; // docs.acme.io → acme, docs
    const title = cleanSelection(page.title);
    const selection = cleanSelection(page.selection);

    return {
        site: 'page',
        key: `page:${parsed.origin}${parsed.pathname}`,
        container: host,
        containerHints: [...hints, ...(title ? [title] : [])],
        identifier: '',
        title: selection || title || host,
        url: `${parsed.origin}${parsed.pathname}${parsed.search}`,
    };
}

/** The same issue with the selection as its title, when there is one. */
export function withSelection(issue: Issue | null, selection: string | null | undefined): Issue | null {
    const text = cleanSelection(selection);
    return issue && text ? { ...issue, title: text } : issue;
}
