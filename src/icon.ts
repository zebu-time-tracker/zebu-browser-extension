// The toolbar icon: the running timer's clock on two lines — hours above,
// minutes below, right-aligned in the green square — and, when nothing runs,
// the Z in a green outline, so a filled square always means "timing".
// Chrome's badge (the strip under the icon) can only hold four characters,
// rendered tiny and cramped; the desktop's tray pill is the model instead.
//
// The glyphs are strokes, not text: a service worker's canvas has no page
// fonts to draw with, and on some platforms fillText paints nothing at all —
// a blank green square in the toolbar. A stroke font of digits, "h" and "m"
// cannot fail, every digit is the same width (so the lines stay tabular), and
// it is crisper at 16px than any typeface would be.

export interface ClockLines {
    top: string;
    bottom: string;
}

/** Whole minutes on the clock → the two lines: "1h" over "35m". */
export function clockLines(minutes: number): ClockLines {
    const m = Math.max(0, Math.round(minutes));
    return { top: `${Math.floor(m / 60)}h`, bottom: `${m % 60}m` };
}

/** A polyline in glyph units: x across, y down, the cell 6 units tall. */
export type Stroke = [number, number][];
interface Glyph {
    width: number;
    strokes: Stroke[];
}

const GLYPHS: Record<string, Glyph> = {
    '0': { width: 3, strokes: [[[0, 0], [3, 0], [3, 6], [0, 6], [0, 0]]] },
    '1': { width: 3, strokes: [[[0.5, 1], [1.5, 0], [1.5, 6]]] },
    '2': { width: 3, strokes: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 6], [3, 6]]] },
    '3': { width: 3, strokes: [[[0, 0], [3, 0], [3, 6], [0, 6]], [[0.75, 3], [3, 3]]] },
    '4': { width: 3, strokes: [[[0, 0], [0, 3], [3, 3]], [[3, 0], [3, 6]]] },
    '5': { width: 3, strokes: [[[3, 0], [0, 0], [0, 3], [3, 3], [3, 6], [0, 6]]] },
    '6': { width: 3, strokes: [[[3, 0], [0, 0], [0, 6], [3, 6], [3, 3], [0, 3]]] },
    '7': { width: 3, strokes: [[[0, 0], [3, 0], [3, 6]]] },
    '8': { width: 3, strokes: [[[0, 0], [3, 0], [3, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]] },
    '9': { width: 3, strokes: [[[3, 3], [0, 3], [0, 0], [3, 0], [3, 6], [0, 6]]] },
    h: { width: 3, strokes: [[[0, 0], [0, 6]], [[0, 2.5], [3, 2.5], [3, 6]]] },
    m: { width: 5, strokes: [[[0, 6], [0, 2.5], [5, 2.5], [5, 6]], [[2.5, 2.5], [2.5, 6]]] },
    Z: { width: 4, strokes: [[[0, 0], [4, 0], [0, 6], [4, 6]]] },
};
const GLYPH_HEIGHT = 6;
const GAP = 1.25;

/** The width of `text` in glyph units, gaps included. */
export const textWidth = (text: string): number => [...text].reduce((w, ch, i) => w + (GLYPHS[ch]?.width ?? 3) + (i ? GAP : 0), 0);

/** The strokes that spell `text` with its left edge at `x` and its top at `top`, one glyph unit being `unit` pixels. */
export function strokesAt(text: string, x: number, top: number, unit: number): Stroke[] {
    const out: Stroke[] = [];
    for (const ch of text) {
        const glyph = GLYPHS[ch] ?? { width: 3, strokes: [] };
        for (const stroke of glyph.strokes) out.push(stroke.map(([gx, gy]) => [x + gx * unit, top + gy * unit]));
        x += (glyph.width + GAP) * unit;
    }
    return out;
}

/** `text` centred on (cx, cy), `height` pixels tall and never wider than `maxWidth`. */
export function textStrokes(text: string, cx: number, cy: number, height: number, maxWidth: number): Stroke[] {
    const width = textWidth(text);
    const unit = Math.min(height / GLYPH_HEIGHT, maxWidth / width);
    return strokesAt(text, cx - (width * unit) / 2, cy - (GLYPH_HEIGHT * unit) / 2, unit);
}

/** The 2D-context methods the drawing uses, so a test or a preview page can supply its own. */
export type ClockContext = Pick<
    CanvasRenderingContext2D,
    'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'beginPath' | 'roundRect' | 'fill' | 'moveTo' | 'lineTo' | 'stroke' | 'clearRect'
>;

export const CLOCK_GREEN = '#197300';

const strokeAll = (ctx: ClockContext, strokes: Stroke[]) => {
    for (const stroke of strokes) {
        ctx.beginPath();
        stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
    }
};

const pen = (ctx: ClockContext, size: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * width);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
};

/** A running timer: the clock, right-aligned so the units line up, in the filled square. */
export function drawClock(ctx: ClockContext, size: number, lines: ClockLines): void {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = CLOCK_GREEN;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();
    // One scale for both lines, so the digits are the same size and the
    // lines share a right edge; small enough that "23h" over "59m" keeps a
    // margin all round at 16px.
    const height = size * 0.3;
    const maxWidth = size * 0.76;
    const unit = Math.min(height / GLYPH_HEIGHT, maxWidth / Math.max(textWidth(lines.top), textWidth(lines.bottom)));
    const right = size * 0.88;
    pen(ctx, size, '#fff', 1 / 14);
    for (const [text, cy] of [
        [lines.top, size * 0.29],
        [lines.bottom, size * 0.71],
    ] as const) {
        strokeAll(ctx, strokesAt(text, right - textWidth(text) * unit, cy - (GLYPH_HEIGHT * unit) / 2, unit));
    }
}

/** Nothing running: the Z inside a green outline, so only a timer fills the square. */
export function drawIdle(ctx: ClockContext, size: number): void {
    ctx.clearRect(0, 0, size, size);
    const inset = Math.max(0.75, size / 16);
    pen(ctx, size, CLOCK_GREEN, 1 / 9);
    ctx.beginPath();
    ctx.roundRect(inset, inset, size - 2 * inset, size - 2 * inset, size * 0.2);
    ctx.stroke();
    strokeAll(ctx, textStrokes('Z', size / 2, size / 2, size * 0.42, size * 0.5));
}

/** The sizes Chrome asks the action icon for, at 1x through 4x. */
export const ICON_SIZES = [16, 32, 48, 64];

const render = (draw: (ctx: ClockContext, size: number) => void): Record<number, ImageData> | null => {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const images: Record<number, ImageData> = {};
    for (const size of ICON_SIZES) {
        const ctx = new OffscreenCanvas(size, size).getContext('2d');
        if (!ctx) return null;
        draw(ctx, size);
        images[size] = ctx.getImageData(0, 0, size, size);
    }
    return images;
};

/** The running clock at every size, or null where there is no canvas to draw on. */
export const clockImages = (minutes: number): Record<number, ImageData> | null => render((ctx, size) => drawClock(ctx, size, clockLines(minutes)));

/** The idle icon at every size, or null where there is no canvas to draw on. */
export const idleImages = (): Record<number, ImageData> | null => render(drawIdle);
