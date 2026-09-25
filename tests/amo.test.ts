import { describe, expect, test } from 'vitest';
import committed from '../amo/listing.json';
import en from '../_locales/en/messages.json';
// @ts-expect-error plain ESM without types: the release scripts' own modules
import { amoLocale, buildListing, LISTING_FILE, listingUrl, readSources, render, SLUG } from '../scripts/amo-listing.mjs';
// @ts-expect-error plain ESM without types
import { classify, EXIT, signJwt } from '../scripts/amo.mjs';

// The public addons.mozilla.org listing is sent with every Firefox release
// (web-ext sign --amo-metadata amo/listing.json). These pin what AMO
// requires of a new listing and keep the committed file honest.

// The AMO API's fixed vocabularies, from the docs the listing cites.
const EXTENSION_LICENSES = ['all-rights-reserved', 'MPL-2.0', 'Apache-2.0', 'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'MIT', 'ISC', 'BSD-2-Clause', 'Unlicense'];
const FIREFOX_CATEGORIES = ['alerts-updates', 'appearance', 'bookmarks', 'download-management', 'feeds-news-blogging', 'games-entertainment', 'language-support', 'photos-music-videos', 'privacy-security', 'search-tools', 'shopping', 'social-communication', 'tabs', 'web-development', 'other'];

describe('amo/listing.json', () => {
    test(`${LISTING_FILE} is what scripts/amo-listing.mjs builds from the locales and captions`, () => {
        const { messages, captions } = readSources();
        expect(render(buildListing(messages, captions))).toBe(render(committed));
    });

    test('carries what AMO requires of a first listed version', () => {
        expect(committed.categories.firefox.length).toBeGreaterThanOrEqual(1);
        expect(committed.categories.firefox.length).toBeLessThanOrEqual(2);
        for (const c of committed.categories.firefox) expect(FIREFOX_CATEGORIES).toContain(c);
        expect(EXTENSION_LICENSES).toContain(committed.version.license);
        expect(committed.summary['en-US']).toBe(en.ext_description.message);
        expect(committed.name['en-US']).toBe('Zebu Time Tracking');
    });

    test('the summary is the store description, in every locale and within the limit', () => {
        const locales = Object.keys(committed.summary);
        expect(locales).toContain('en-US');
        expect(locales.length).toBe(11);
        for (const s of Object.values(committed.summary)) expect(s.length).toBeLessThanOrEqual(250);
        expect(Object.keys(committed.description)).toEqual(locales);
    });

    test('the slug is a valid AMO slug and the listing url is built from it', () => {
        expect(committed.slug).toBe(SLUG);
        expect(committed.slug).toMatch(/^[\p{L}\p{N}_~-]+$/u);
        expect(committed.slug).not.toMatch(/^\d+$/);
        expect(listingUrl(committed.slug)).toBe('https://addons.mozilla.org/firefox/addon/zebu-time-tracking/');
    });

    test('links the site, and tells reviewers how to rebuild', () => {
        expect(committed.homepage['en-US']).toBe('https://zebu.work');
        expect(committed.support_url['en-US']).toBe('https://zebu.work/support');
        expect(committed.version.approval_notes).toContain('npm run build:firefox');
    });

    test('_locales folders map to the locale codes AMO accepts', () => {
        expect(amoLocale('en')).toBe('en-US');
        expect(amoLocale('es')).toBe('es-ES');
        expect(amoLocale('pt_BR')).toBe('pt-BR');
        expect(amoLocale('zh_CN')).toBe('zh-CN');
        expect(amoLocale('de')).toBe('de');
    });
});

describe('scripts/amo.mjs', () => {
    test('signs a five-minute HS256 JWT for the issuer', () => {
        const token = signJwt('user:1:2', 'secret', 1_700_000_000);
        const [header, payload, signature] = token.split('.');
        const decode = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
        expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
        const claims = decode(payload);
        expect(claims.iss).toBe('user:1:2');
        expect(claims.iat).toBe(1_700_000_000);
        expect(claims.exp).toBe(1_700_000_300);
        expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
        expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(signJwt('user:1:2', 'other', 1_700_000_000).split('.')[2]).not.toBe(signature);
    });

    test('reads a version detail the way the release step branches on it', () => {
        expect(classify(null)).toEqual({ state: 'missing' });
        expect(classify({ file: { status: 'unreviewed', url: 'x' } })).toEqual({ state: 'pending' });
        expect(classify({ file: { status: 'public', url: 'https://addons.mozilla.org/firefox/downloads/file/1/z.xpi' } })).toEqual({
            state: 'approved',
            url: 'https://addons.mozilla.org/firefox/downloads/file/1/z.xpi',
        });
        expect(classify({ file: { status: 'disabled' } })).toEqual({ state: 'disabled' });
        expect(classify({})).toEqual({ state: 'pending' });
        expect(EXIT).toEqual({ approved: 0, disabled: 1, pending: 2, missing: 3 });
    });
});
