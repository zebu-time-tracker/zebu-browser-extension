// Generates the extension icons (PNG) without any image library: the Zebu
// mark (board #328) — a rounded square on the mark's green, the Z and a faint
// diagonal in its light ink — traced from the brand SVG (1022 × 1022, corner radius 180) and
// supersampled for smooth edges. Run `npm run icons`; output goes to
// icons/{16,32,48,128}.png.
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
const LINE_OPACITY = 0.4;
const LINE_MIX = GREEN.map((g, i) => Math.round(g + (INK[i] - g) * LINE_OPACITY));

function insideZ(u, v) {
    let inside = false;
    for (let i = 0, j = Z.length - 1; i < Z.length; j = i++) {
        const [xi, yi] = Z[i];
        const [xj, yj] = Z[j];
        if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function onLine(u, v) {
    const dx = LINE.x2 - LINE.x1, dy = LINE.y2 - LINE.y1;
    const tt = ((u - LINE.x1) * dx + (v - LINE.y1) * dy) / (dx * dx + dy * dy);
    if (tt < 0 || tt > 1) return false;
    const px = LINE.x1 + tt * dx, py = LINE.y1 + tt * dy;
    return Math.hypot(u - px, v - py) <= LINE.half;
}

/** Colour of one sample point (u, v in 0..1), or null outside the rounded square. */
function sample(u, v) {
    const r = CORNER;
    const cx = Math.min(Math.max(u, r), 1 - r);
    const cy = Math.min(Math.max(v, r), 1 - r);
    if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;
    if (insideZ(u, v)) return INK;
    if (onLine(u, v)) return LINE_MIX;
    return GREEN;
}

function png(size) {
    const ss = 4; // supersampling factor
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            let alpha = 0, rr = 0, gg = 0, bb = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
                    if (c === null) continue;
                    alpha++; rr += c[0]; gg += c[1]; bb += c[2];
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
for (const size of [16, 32, 48, 128]) writeFileSync(`icons/${size}.png`, png(size));
console.log('icons/16.png … icons/128.png written');
