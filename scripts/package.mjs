#!/usr/bin/env node
// Zips each built target into dist/zebu-<target>-<version>.zip: the file the
// Chrome Web Store takes as is, the one AMO signs into an .xpi, and the
// folder the Safari converter unpacks. Run `node build.mjs --target all`
// first. Uses the system zip so the archive has no top-level folder, which
// both stores insist on.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { packageName, TARGETS } from './manifest.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const wanted = process.argv[2] ?? 'all';
const targets = wanted === 'all' ? TARGETS : [wanted];

for (const target of targets) {
    if (!existsSync(`dist/${target}/manifest.json`)) throw new Error(`dist/${target} is not built (node build.mjs --target ${target})`);
    const name = packageName(target, version);
    rmSync(`dist/${name}`, { force: true });
    execFileSync('zip', ['-qr', `../${name}`, '.'], { cwd: `dist/${target}`, stdio: 'inherit' });
    console.log(`dist/${name}`);
}
