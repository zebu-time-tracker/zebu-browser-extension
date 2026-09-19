#!/usr/bin/env node
// Builds what a release puts in front of the downloads page and of every
// installed Firefox copy, from a flat directory of built packages:
//
//   node scripts/extension-manifest.mjs \
//     --version 0.3.0 \
//     --dir upload \
//     --base-url https://app-downloads.zebu.work/extension/0.3.0 \
//     --aliases-out aliases.tsv \
//     --updates-out updates.json \
//     [--gecko-id extension@zebu.work] [--chrome-store https://chromewebstore.google.com/detail/…] \
//     [--pub-date 2026-09-19T17:00:00Z]
//
// Prints latest.json on stdout: `{ version, pub_date, builds: { chrome, firefox,
// safari } }`, each build a `{ file, url, size }` plus the store link when one is
// known. Writes the alias table the publisher reads (stable name → versioned
// file: `zebu-chrome.zip` → `zebu-chrome-0.3.0.zip`) and Firefox's update
// manifest, the document `browser_specific_settings.gecko.update_url` points at.
//
// Two rules this file exists to enforce:
//
//   1. Every URL points into the immutable per-version prefix, never at a
//      `latest/` alias. Firefox checks the sha256 in updates.json against the
//      exact bytes it downloads, so an alias mid-overwrite would fail as a
//      hash error rather than install the wrong build. --base-url must end
//      in the version.
//   2. A target with no package in the directory is an error, not a silently
//      thinner manifest — a downloads page that quietly drops a browser
//      strands everyone on it. Safari is the exception until its store
//      pipeline exists: absent is allowed, and the manifest says so.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['chrome', 'firefox'];
const OPTIONAL = ['safari'];

/** Which file in the directory is which target's package: the signed .xpi wins over a plain zip for Firefox. */
export function pickPackages(files, version) {
    const builds = {};
    for (const target of [...REQUIRED, ...OPTIONAL]) {
        const prefix = `zebu-${target}-${version}.`;
        const candidates = files.filter((f) => f.startsWith(prefix)).sort((a, b) => rank(a) - rank(b));
        if (candidates.length > 0) builds[target] = candidates[0];
        else if (REQUIRED.includes(target)) throw new Error(`no package for ${target} (${prefix}zip or .xpi) in the upload directory`);
    }
    return builds;
}

const rank = (name) => (name.endsWith('.xpi') ? 0 : name.endsWith('.zip') ? 1 : 2);

/** The stable alias names the downloads page links to, one per built target. */
export const aliasFor = (target, file) => `zebu-${target}.${file.split('.').pop()}`;

export function buildManifest({ version, baseUrl, files, sizes, pubDate, chromeStore }) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version '${version}' is not X.Y.Z`);
    if (!baseUrl.endsWith(`/${version}`)) throw new Error(`--base-url must end in /${version} so every link is immutable`);
    const packages = pickPackages(files, version);
    const builds = {};
    for (const [target, file] of Object.entries(packages)) {
        builds[target] = { file, url: `${baseUrl}/${file}`, size: sizes[file] };
    }
    if (chromeStore) builds.chrome.store = chromeStore;
    return { version, pub_date: pubDate, builds };
}

/** Firefox's update manifest: https://extensionworkshop.com/documentation/manage/updating-your-extension/ */
export function buildUpdates({ geckoId, version, url, sha256 }) {
    return { addons: { [geckoId]: { updates: [{ version, update_link: url, update_hash: `sha256:${sha256}` }] } } };
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) throw new Error(`unexpected argument '${argv[i]}'`);
        args[argv[i].slice(2)] = argv[++i];
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    for (const key of ['version', 'dir', 'base-url']) if (!args[key]) throw new Error(`--${key} is required`);
    const geckoId = args['gecko-id'] ?? 'extension@zebu.work';
    const pubDate = args['pub-date'] ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const files = readdirSync(args.dir).filter((f) => statSync(join(args.dir, f)).isFile());
    const sizes = Object.fromEntries(files.map((f) => [f, statSync(join(args.dir, f)).size]));
    const manifest = buildManifest({ version: args.version, baseUrl: args['base-url'], files, sizes, pubDate, chromeStore: args['chrome-store'] });

    if (args['aliases-out']) {
        const rows = Object.entries(manifest.builds).map(([target, b]) => `${aliasFor(target, b.file)}\t${b.file}`);
        writeFileSync(args['aliases-out'], rows.join('\n') + '\n');
    }
    if (args['updates-out']) {
        const firefox = manifest.builds.firefox;
        if (!firefox.file.endsWith('.xpi')) throw new Error('the Firefox package is not a signed .xpi; Firefox will not install an unsigned update');
        const sha256 = createHash('sha256').update(readFileSync(join(args.dir, firefox.file))).digest('hex');
        writeFileSync(args['updates-out'], JSON.stringify(buildUpdates({ geckoId, version: args.version, url: firefox.url, sha256 }), null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('extension-manifest.mjs')) {
    try {
        main();
    } catch (e) {
        console.error(`extension-manifest: ${e.message}`);
        process.exit(1);
    }
}
