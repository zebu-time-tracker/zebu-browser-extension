#!/usr/bin/env node
// The public addons.mozilla.org listing, as the JSON `web-ext sign
// --amo-metadata` sends with every Firefox release (the "Add-on Create /
// Version Create" request body, https://mozilla.github.io/addons-server/topics/api/addons.html).
//
//   node scripts/amo-listing.mjs            # print it
//   node scripts/amo-listing.mjs --write    # refresh amo/listing.json
//   node scripts/amo-listing.mjs --check    # amo/listing.json is up to date
//
// The committed amo/listing.json is what a release ships; this script is
// where it comes from, so the translated summary stays the same sentence
// the Chrome Web Store shows (`ext_description` in every _locales/*), and
// the description is the four screenshot captions AMO's listing shares with
// the other stores (scripts/listing-captions.json). tests/amo.test.ts fails
// when the file and the sources disagree. Everything AMO needs for a brand
// new listing is here: categories, summary and the version's license are
// required the first time (web-ext command reference, `--amo-metadata`).
//
// Two facts that are not in the locales live here as constants: the slug
// (the listing URL) and the license, MIT like the repository's LICENSE;
// change it here and nowhere else.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LISTING_FILE = 'amo/listing.json';

/** The listing URL: https://addons.mozilla.org/firefox/addon/<slug>/ */
export const SLUG = 'zebu-time-tracking';
/** An AMO license slug for extensions (…/topics/api/licenses.html), matching LICENSE. */
export const LICENSE = 'MIT';
/** Firefox extension categories, at most two (…/topics/api/categories.html has no "productivity"). AMO refuses "other" next to any other category. */
export const CATEGORIES = ['web-development'];
export const HOMEPAGE = 'https://zebu.work';
export const SUPPORT_URL = 'https://zebu.work/support';

/** _locales folder → AMO locale code (settings_base.py: SHORTER_LANGUAGES maps en→en-US, es→es-ES, zh→zh-CN). */
export const AMO_LOCALES = { en: 'en-US', es: 'es-ES', pt_BR: 'pt-BR', zh_CN: 'zh-CN' };
export const amoLocale = (folder) => AMO_LOCALES[folder] ?? folder.replace('_', '-');

export const listingUrl = (slug) => `https://addons.mozilla.org/firefox/addon/${slug}/`;

/**
 * @param {Record<string, Record<string, {message: string}>>} messages  _locales folder → messages.json
 * @param {Record<string, Record<string, {title: string, body: string}|string>>} captions  scripts/listing-captions.json
 */
export function buildListing(messages, captions) {
    const translated = (pick) =>
        Object.fromEntries(
            Object.keys(messages)
                .sort()
                .map((folder) => [amoLocale(folder), pick(folder)])
                .filter(([, value]) => typeof value === 'string' && value.length > 0),
        );
    const description = (folder) => {
        const c = captions[folder];
        if (!c) return undefined;
        const paragraphs = Object.keys(c)
            .filter((k) => /^\d/.test(k))
            .sort()
            .map((k) => `**${c[k].title}** — ${c[k].body}`);
        return [messages[folder].ext_description.message, ...paragraphs].join('\n\n');
    };
    return {
        default_locale: 'en-US',
        slug: SLUG,
        name: translated((f) => messages[f].ext_name.message),
        summary: translated((f) => messages[f].ext_description.message),
        description: translated(description),
        categories: { firefox: CATEGORIES },
        homepage: { 'en-US': HOMEPAGE },
        support_url: { 'en-US': SUPPORT_URL },
        version: {
            license: LICENSE,
            approval_notes:
                'The package is dist/firefox from the attached source: Node 22, `npm ci`, `npm run build:firefox` ' +
                '(esbuild bundles and minifies src/*.ts; see README.md, "Reproducing a build"). ' +
                'The extension talks only to the Zebu workspace the user signs in to (<workspace>.zebu.work).',
        },
    };
}

export function readSources(root = ROOT) {
    const messages = Object.fromEntries(
        readdirSync(join(root, '_locales')).map((folder) => [folder, JSON.parse(readFileSync(join(root, '_locales', folder, 'messages.json'), 'utf8'))]),
    );
    const captions = JSON.parse(readFileSync(join(root, 'scripts', 'listing-captions.json'), 'utf8'));
    return { messages, captions };
}

export const render = (listing) => JSON.stringify(listing, null, 4) + '\n';

function main() {
    const { messages, captions } = readSources();
    const text = render(buildListing(messages, captions));
    const file = join(ROOT, LISTING_FILE);
    if (process.argv.includes('--write')) {
        writeFileSync(file, text);
        console.log(`wrote ${LISTING_FILE}`);
    } else if (process.argv.includes('--check')) {
        if (readFileSync(file, 'utf8') !== text) {
            console.error(`${LISTING_FILE} is out of date: run node scripts/amo-listing.mjs --write`);
            process.exit(1);
        }
        console.log(`${LISTING_FILE} is up to date`);
    } else {
        process.stdout.write(text);
    }
}

if (process.argv[1] && process.argv[1].endsWith('amo-listing.mjs')) main();
