// Workspace address handling, the same rules as the desktop app's
// src/workspace.ts (board #270): a bare name is a hosted workspace at
// {name}.zebu.work, the central site is refused because it serves no
// workspace API, and plain http is only ever allowed for loopback and
// development hosts. Pure functions, unit-tested.

/** Hosted Zebu: every workspace is served from {subdomain}.zebu.work. */
export const DEFAULT_DOMAIN = 'zebu.work';

/** The central site — signup, "find your workspace", operator admin. It has no per-workspace API. */
export const CENTRAL_URL = 'https://app.zebu.work';

/** Hosts a bare workspace name might be confused with, none of which serve the API. */
const CENTRAL_HOSTS = new Set([DEFAULT_DOMAIN, `app.${DEFAULT_DOMAIN}`, `www.${DEFAULT_DOMAIN}`, `www.app.${DEFAULT_DOMAIN}`]);

/** Loopback / development hosts, the only ones plain http is ever allowed for. */
export function isLocalHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.test');
}

export type WorkspaceResolution = { ok: true; origin: string } | { ok: false; reason: 'empty' | 'invalid' | 'central' | 'insecure' };

export interface ResolveOptions {
    /** Domain a bare name is completed with. */
    defaultDomain?: string;
    /** Plain http to any host; the extension never sets this, only loopback is allowed. */
    allowInsecure?: boolean;
}

/**
 * Turn what the user typed on the options page into a workspace origin.
 * Accepts a bare name, a host, or a full URL (paths, query and trailing
 * slashes are dropped):
 *   "studio"                      → https://studio.zebu.work
 *   "Studio.zebu.work/login"      → https://studio.zebu.work
 *   "https://studio.zebu.work/"   → https://studio.zebu.work
 *   "http://127.0.0.1:8003/"      → http://127.0.0.1:8003   (local dev)
 * Plain http to a non-loopback host is refused, and the central site is
 * refused because it serves no workspace.
 */
export function resolveWorkspace(input: string, { defaultDomain = DEFAULT_DOMAIN, allowInsecure = false }: ResolveOptions = {}): WorkspaceResolution {
    let value = input.trim();
    if (value === '') return { ok: false, reason: 'empty' };

    // "studio.zebu.work" and "studio" both lack a scheme; the latter also lacks a dot.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        const host = value.split(/[/?#]/)[0];
        // a bare name only ever means a hosted workspace: lowercase, dots/ports not allowed
        if (!host.includes('.') && !host.includes(':')) {
            if (!/^[a-z0-9][a-z0-9-]*$/i.test(host)) return { ok: false, reason: 'invalid' };
            value = `https://${host.toLowerCase()}.${defaultDomain}`;
        } else {
            value = `https://${value}`;
        }
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return { ok: false, reason: 'invalid' };
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'invalid' };
    if (!url.hostname || url.username || url.password) return { ok: false, reason: 'invalid' };
    if (CENTRAL_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: 'central' };
    if (url.protocol === 'http:' && !allowInsecure && !isLocalHost(url.hostname)) return { ok: false, reason: 'insecure' };

    return { ok: true, origin: `${url.protocol}//${url.host.toLowerCase()}` };
}

/** Convenience form of {@link resolveWorkspace}: the origin, or '' when the input isn't a workspace. */
export function workspaceUrl(input: string, options: ResolveOptions = {}): string {
    const r = resolveWorkspace(input, options);
    return r.ok ? r.origin : '';
}

/**
 * Earlier builds completed bare names with the old `{sub}.app.zebu.work`
 * layout. Workspaces now live directly under zebu.work; the token is per
 * workspace, not per host, so a stored origin can simply be rewritten.
 */
export function migrateWorkspaceOrigin(origin: string): string {
    const m = origin.match(/^https:\/\/([a-z0-9-]+)\.app\.zebu\.work$/i);
    return m ? `https://${m[1].toLowerCase()}.${DEFAULT_DOMAIN}` : origin;
}
