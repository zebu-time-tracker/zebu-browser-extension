// Bundles the four entry points with esbuild and copies the static files into
// dist/, which is what you load unpacked in chrome://extensions (or zip for
// the Web Store). Content scripts and the service worker must be single
// self-contained files, hence IIFE bundles rather than ES modules.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const common = {
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

const contexts = await Promise.all([
    esbuild.context({ ...common, entryPoints: ['src/background.ts'], outfile: 'dist/background.js' }),
    esbuild.context({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js' }),
    esbuild.context({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js' }),
    esbuild.context({ ...common, entryPoints: ['src/options/options.ts'], outfile: 'dist/options.js' }),
]);

const copyStatic = () => {
    cpSync('manifest.json', 'dist/manifest.json');
    cpSync('src/popup/popup.html', 'dist/popup.html');
    cpSync('src/popup/popup.css', 'dist/popup.css');
    cpSync('src/options/options.html', 'dist/options.html');
    cpSync('src/options/options.css', 'dist/options.css');
    cpSync('src/content/content.css', 'dist/content.css');
    cpSync('_locales', 'dist/_locales', { recursive: true });
    if (existsSync('icons')) cpSync('icons', 'dist/icons', { recursive: true });
};

if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    copyStatic();
    console.log('watching… (static files are copied once; re-run for manifest/html/css changes)');
} else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
    copyStatic();
    console.log('built dist/');
}
