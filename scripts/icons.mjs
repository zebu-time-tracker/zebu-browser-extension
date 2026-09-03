// Generates the extension icons (PNG) without any image library: a rounded
// square in Zebu green with a white "Z", supersampled for smooth edges.
// Run `npm run icons`; output goes to icons/{16,32,48,128}.png.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const GREEN = [0x19, 0x73, 0x00];
const WHITE = [0xff, 0xff, 0xff];

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

/** Coverage of one sample point (u, v in 0..1): 0 = transparent, 1 = green, 2 = white. */
function sample(u, v) {
    const r = 0.22;
    const inRounded = (() => {
        const cx = Math.min(Math.max(u, r), 1 - r);
        const cy = Math.min(Math.max(v, r), 1 - r);
        return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
    })();
    if (!inRounded) return 0;

    // The Z: two bars and a diagonal, inside a 0.22..0.78 box.
    const left = 0.24, right = 0.76, top = 0.25, bottom = 0.75, thick = 0.13;
    const inX = u >= left && u <= right;
    if (inX && v >= top && v <= top + thick) return 2;
    if (inX && v >= bottom - thick && v <= bottom) return 2;
    // Diagonal from (right, top + thick) to (left, bottom - thick).
    const x1 = right, y1 = top + thick, x2 = left, y2 = bottom - thick;
    const dx = x2 - x1, dy = y2 - y1;
    const tt = ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy);
    if (tt >= 0 && tt <= 1) {
        const px = x1 + tt * dx, py = y1 + tt * dy;
        if (Math.hypot(u - px, v - py) <= thick * 0.62) return 2;
    }
    return 1;
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
                    const s = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
                    if (s === 0) continue;
                    const c = s === 2 ? WHITE : GREEN;
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
