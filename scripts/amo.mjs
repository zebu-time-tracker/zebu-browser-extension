#!/usr/bin/env node
// The two things a release needs from the addons.mozilla.org API that
// `web-ext sign` does not do (https://mozilla.github.io/addons-server/topics/api/):
//
//   node scripts/amo.mjs await-signed --version 0.3.0 --out upload/zebu-firefox-0.3.0.xpi [--wait 900]
//       Downloads the signed file of that version once Mozilla has approved
//       it, polling for up to --wait seconds (0 = look once). Exit codes:
//         0  written             2  submitted, still awaiting review
//         3  not on AMO yet      1  rejected or disabled, or a real error
//   node scripts/amo.mjs set-policy --file amo/privacy-policy.md
//       Sets the listing's privacy policy (PATCH …/eula_policy/), a field
//       the create request does not carry.
//
// Credentials come from the environment under the names web-ext uses,
// WEB_EXT_API_KEY and WEB_EXT_API_SECRET, and never appear in output. The
// add-on is the manifest's gecko id (--id, default extension@zebu.work).
//
// A listed version is signed only after review, which can take minutes
// (auto-approval) or days (a human), so the release workflow submits with
// web-ext, then waits here for a bounded time and carries on without the
// file if the review is still open; re-running the release later finds the
// version approved and picks the file up (docs/release.md).

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const API_BASE = 'https://addons.mozilla.org/api/v5/';
export const DEFAULT_ID = 'extension@zebu.work';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A five-minute HS256 JWT, the API's auth token (…/topics/api/auth.html). */
export function signJwt(issuer, secret, now = Math.floor(Date.now() / 1000)) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 }));
    const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${signature}`;
}

/**
 * What a version's detail says about its signed file. `file.status` is
 * `public` once approved, `unreviewed` while waiting, `disabled` when
 * rejected or disabled (…/topics/api/addons.html, version/file status).
 */
export function classify(detail) {
    if (detail === null) return { state: 'missing' };
    const file = detail.file ?? detail.files?.[0];
    if (!file) return { state: 'pending' };
    if (file.status === 'public') return { state: 'approved', url: file.url };
    if (file.status === 'disabled') return { state: 'disabled' };
    return { state: 'pending' };
}

export const EXIT = { approved: 0, disabled: 1, pending: 2, missing: 3 };

function credentials() {
    const issuer = process.env.WEB_EXT_API_KEY;
    const secret = process.env.WEB_EXT_API_SECRET;
    if (!issuer || !secret) throw new Error('WEB_EXT_API_KEY / WEB_EXT_API_SECRET are not set');
    return { issuer, secret };
}

async function api(path, { method = 'GET', body } = {}) {
    const { issuer, secret } = credentials();
    const headers = { Authorization: `JWT ${signJwt(issuer, secret)}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(path, API_BASE), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 500)}`);
    return response.json();
}

async function versionDetail(id, version) {
    return api(`addons/addon/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/`);
}

async function download(url, out) {
    const { issuer, secret } = credentials();
    const response = await fetch(url, { headers: { Authorization: `JWT ${signJwt(issuer, secret)}` } });
    if (!response.ok) throw new Error(`download ${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 4 || bytes.toString('latin1', 0, 2) !== 'PK') throw new Error(`download ${url}: not a zip archive`);
    writeFileSync(out, bytes);
    return bytes.length;
}

const sleep = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));

async function awaitSigned({ id, version, out, wait, interval = 30 }) {
    const deadline = Date.now() + wait * 1000;
    for (;;) {
        const detail = await versionDetail(id, version);
        const { state, url } = classify(detail);
        if (state === 'approved') {
            const size = await download(url, out);
            console.log(`${version} is approved: wrote ${out} (${size} bytes)`);
            return EXIT.approved;
        }
        if (state === 'missing') {
            console.log(`${version} is not on AMO`);
            return EXIT.missing;
        }
        if (state === 'disabled') {
            console.error(`${version} was rejected or disabled on AMO; see the developer hub`);
            return EXIT.disabled;
        }
        if (Date.now() + interval * 1000 > deadline) {
            console.log(`${version} is still awaiting review on AMO`);
            return EXIT.pending;
        }
        await sleep(interval);
    }
}

async function setPolicy({ id, file }) {
    const text = readFileSync(file, 'utf8').trim();
    await api(`addons/addon/${encodeURIComponent(id)}/eula_policy/`, { method: 'PATCH', body: { privacy_policy: { 'en-US': text } } });
    console.log(`privacy policy set from ${file}`);
    return 0;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) throw new Error(`unexpected argument '${argv[i]}'`);
        args[argv[i].slice(2)] = argv[++i];
    }
    return args;
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);
    const id = args.id ?? DEFAULT_ID;
    switch (command) {
        case 'await-signed': {
            for (const key of ['version', 'out']) if (!args[key]) throw new Error(`--${key} is required`);
            return awaitSigned({ id, version: args.version, out: args.out, wait: Number(args.wait ?? 0) });
        }
        case 'set-policy': {
            if (!args.file) throw new Error('--file is required');
            return setPolicy({ id, file: args.file });
        }
        default:
            throw new Error('usage: amo.mjs await-signed --version X.Y.Z --out file [--wait seconds] | set-policy --file path');
    }
}

if (process.argv[1] && process.argv[1].endsWith('amo.mjs')) {
    main().then(
        (code) => process.exit(code),
        (e) => {
            console.error(`amo: ${e.message}`);
            process.exit(1);
        },
    );
}
