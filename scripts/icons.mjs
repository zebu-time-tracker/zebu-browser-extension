// Generates the extension icons (PNG) without any image library, both traced
// from the brand SVGs in their own 1022 × 1022 space and supersampled for
// smooth edges. Run `npm run icons`.
//
//   icons/{16,32,48,128}.png       the app icon (board #328): the Z and a
//                                  faint diagonal in light ink on the green
//   icons/idle-{16,32,48,128}.png  the toolbar icon while no timer runs
//                                  (board #353): the same mark hollow — a
//                                  stroked square on nothing, the Z in green,
//                                  the diagonal at half strength — so a
//                                  filled square always means "timing"
//
// The hollow one is Alan's drawing figure for figure, which is why its
// numbers differ from the app icon's: with no ground to sit on, the Z is
// drawn larger and the square is an outline rather than a fill.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const GREEN = [0x4c, 0xa1, 0x54]; // the mark's ground
const INK = [0xd0, 0xff, 0xc5]; // the mark's ink: the Z and the faint diagonal

const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
};

// The mark's geometry in its own 1022 × 1022 space, scaled to 0..1 below.
const SIDE = 1022;
const CORNER = 180 / SIDE;
// The Z, as the closed polygon of the brand SVG's path.
const Z = [
    [300.31, 802], [300.31, 741.33], [606.327, 296.684], [309.889, 296.684], [309.889, 227.232],
    [713.823, 227.232], [713.823, 287.902], [408.267, 732.549], [720.209, 732.549], [720.209, 802],
].map(([x, y]) => [x / SIDE, y / SIDE]);
// The faint diagonal behind the Z: the ink at 40 % over the ground.
const LINE = { x1: 330.463 / SIDE, y1: 282.512 / SIDE, x2: 700.463 / SIDE, y2: 748.512 / SIDE, half: 49.893 / SIDE / 2 };

// ---- the hollow toolbar icon (board #353), from Chrome Icon - Inactive.svg
// The square is stroked, not filled: a rect inset 20 with corner radius 160,
// under a 40-wide line centred on its path.
const HOLLOW = {
    inset: 20 / SIDE,
    corner: 160 / SIDE,
    halfStroke: 40 / SIDE / 2,
    // The diagonal, at half strength, behind the Z.
    line: { x1: 748.175 / SIDE, y1: 802.276 / SIDE, x2: 286.615 / SIDE, y2: 220.96 / SIDE, half: 62.2396 / SIDE / 2, alpha: 0.5 },
    z: [
        [249, 869], [249, 793.317], [630.744, 238.638], [260.95, 238.638], [260.95, 152],
        [764.842, 152], [764.842, 227.683], [383.673, 782.363], [772.808, 782.363], [772.808, 869],
    ].map(([x, y]) => [x / SIDE, y / SIDE]),
};
const LINE_OPACITY = 0.4;
const LINE_MIX = GREEN.map((g, i) => Math.round(g + (INK[i] - g) * LINE_OPACITY));

function insidePolygon(poly, u, v) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const insideZ = (u, v) => insidePolygon(Z, u, v);

function onLine(line, u, v) {
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const tt = ((u - line.x1) * dx + (v - line.y1) * dy) / (dx * dx + dy * dy);
    if (tt < 0 || tt > 1) return false;
    const px = line.x1 + tt * dx, py = line.y1 + tt * dy;
    return Math.hypot(u - px, v - py) <= line.half;
}

/**
 * How far (u, v) is from the edge of the hollow icon's rounded square —
 * negative inside, positive outside. The stroke is drawn where that distance
 * is within half a stroke of zero, which is what "centred on the path" means.
 */
function edgeDistance(u, v) {
    const half = 0.5 - HOLLOW.inset - HOLLOW.corner;
    const qx = Math.abs(u - 0.5) - half;
    const qy = Math.abs(v - 0.5) - half;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - HOLLOW.corner;
}

/** The hollow icon: [r, g, b, alpha 0..1] at one sample point, alpha 0 for the empty ground. */
function sampleHollow(u, v) {
    if (Math.abs(edgeDistance(u, v)) <= HOLLOW.halfStroke) return [...GREEN, 1];
    if (insidePolygon(HOLLOW.z, u, v)) return [...GREEN, 1];
    if (onLine(HOLLOW.line, u, v)) return [...GREEN, HOLLOW.line.alpha];
    return [0, 0, 0, 0];
}

/** Colour of one sample point (u, v in 0..1), or null outside the rounded square. */
function sample(u, v) {
    const r = CORNER;
    const cx = Math.min(Math.max(u, r), 1 - r);
    const cy = Math.min(Math.max(v, r), 1 - r);
    if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;
    if (insideZ(u, v)) return INK;
    if (onLine(LINE, u, v)) return LINE_MIX;
    return GREEN;
}

function png(size, sampler = sample) {
    const ss = 4; // supersampling factor
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            let alpha = 0, rr = 0, gg = 0, bb = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const c = sampler((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
                    if (c === null) continue;
                    // A sampler may carry its own alpha (the hollow icon's
                    // half-strength diagonal); the filled one is solid.
                    const a = c.length > 3 ? c[3] : 1;
                    if (a === 0) continue;
                    alpha += a; rr += c[0] * a; gg += c[1] * a; bb += c[2] * a;
                }
            }
            const o = y * (size * 4 + 1) + 1 + x * 4;
            if (alpha === 0) continue;
            raw[o] = Math.round(rr / alpha);
            raw[o + 1] = Math.round(gg / alpha);
            raw[o + 2] = Math.round(bb / alpha);
            raw[o + 3] = Math.round((alpha / (ss * ss)) * 255);
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
    writeFileSync(`icons/${size}.png`, png(size));
    writeFileSync(`icons/idle-${size}.png`, png(size, sampleHollow));
}
console.log('icons/16.png … icons/128.png and icons/idle-16.png … icons/idle-128.png written');
