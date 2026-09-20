// Bundles the four entry points with esbuild and copies the static files into
// dist/<target>/, one directory per browser: what you load unpacked (Chrome,
// Firefox's "load temporary add-on", or the folder the Safari converter
// reads) and what scripts/package.mjs zips for the stores and R2.
//
//   node build.mjs                    # chrome
//   node build.mjs --target firefox   # one target
//   node build.mjs --target all       # every target
//   node build.mjs --watch            # chrome, rebuilt on change
//
// Content scripts and the service worker must be single self-contained
// files, hence IIFE bundles rather than ES modules. The manifest is built by
// scripts/manifest.mjs from manifest.base.json + browsers/<target>.json, and
// `__TARGET__` is baked in so src/platform.ts knows which browser it is on
// without sniffing user agents.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { manifestFor, TARGETS } from './scripts/manifest.mjs';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const wanted = args[args.indexOf('--target') + 1];
const targets = args.includes('--target') ? (wanted === 'all' ? TARGETS : [wanted]) : ['chrome'];
for (const t of targets) if (!TARGETS.includes(t)) throw new Error(`unknown target '${t}' (chrome, firefox, safari or all)`);
if (watch && targets.length > 1) throw new Error('--watch takes one target');

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const base = JSON.parse(readFileSync('manifest.base.json', 'utf8'));

/** The oldest engine each build is compiled for; matches the manifest minimums. */
const ENGINE = { chrome: 'chrome120', firefox: 'firefox128', safari: 'safari17' };

// Building every target starts from an empty dist/; one target replaces only
// its own folder, so the other browsers' builds (and any packages) survive.
if (targets.length === TARGETS.length) rmSync('dist', { recursive: true, force: true });

async function build(target) {
    const out = `dist/${target}`;
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    const common = {
        bundle: true,
        format: 'iife',
        target: ENGINE[target],
        sourcemap: watch ? 'inline' : false,
        minify: !watch,
        logLevel: 'info',
        define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"', __TARGET__: JSON.stringify(target) },
    };

    const contexts = await Promise.all([
        esbuild.context({ ...common, entryPoints: ['src/background.ts'], outfile: `${out}/background.js` }),
        esbuild.context({ ...common, entryPoints: ['src/content/index.ts'], outfile: `${out}/content.js` }),
        esbuild.context({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: `${out}/popup.js` }),
        esbuild.context({ ...common, entryPoints: ['src/options/options.ts'], outfile: `${out}/options.js` }),
    ]);

    const copyStatic = () => {
        const overlay = JSON.parse(readFileSync(`browsers/${target}.json`, 'utf8'));
        writeFileSync(`${out}/manifest.json`, JSON.stringify(manifestFor(target, base, overlay, version), null, 4) + '\n');
        cpSync('src/popup/popup.html', `${out}/popup.html`);
        cpSync('src/popup/popup.css', `${out}/popup.css`);
        cpSync('src/options/options.html', `${out}/options.html`);
        cpSync('src/options/options.css', `${out}/options.css`);
        cpSync('src/content/content.css', `${out}/content.css`);
        cpSync('_locales', `${out}/_locales`, { recursive: true });
        if (existsSync('icons')) cpSync('icons', `${out}/icons`, { recursive: true });
    };

    if (watch) {
        await Promise.all(contexts.map((c) => c.watch()));
        copyStatic();
        console.log(`watching ${out}/… (static files are copied once; re-run for manifest/html/css changes)`);
    } else {
        await Promise.all(contexts.map((c) => c.rebuild()));
        await Promise.all(contexts.map((c) => c.dispose()));
        copyStatic();
        console.log(`built ${out}/ (${version})`);
    }
}

for (const target of targets) await build(target);
