// One manifest per browser from one source: manifest.base.json plus the
// overlay in browsers/<target>.json, with the version stamped from
// package.json so the three builds can never disagree about what they are.
//
// The overlay merges shallowly: a top-level key in the overlay replaces the
// base's (arrays included, so browsers/safari.json lists the full permission
// set it supports rather than describing a diff), and a nested object merges
// one level down. Pure: nothing here touches the disk, so tests/build.test.ts
// can check every target's manifest without running esbuild.

export const TARGETS = ['chrome', 'firefox', 'safari'];

export function manifestFor(target, base, overlay, version) {
    if (!TARGETS.includes(target)) throw new Error(`unknown target '${target}' (one of ${TARGETS.join(', ')})`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version '${version}' is not X.Y.Z`);
    const out = structuredClone(base);
    for (const [key, value] of Object.entries(overlay)) {
        const current = out[key];
        out[key] = isPlainObject(value) && isPlainObject(current) ? { ...current, ...value } : structuredClone(value);
    }
    out.version = version;
    return out;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The file name each target's package is released under, e.g. zebu-firefox-0.3.0.zip. */
export const packageName = (target, version, ext = 'zip') => `zebu-${target}-${version}.${ext}`;
