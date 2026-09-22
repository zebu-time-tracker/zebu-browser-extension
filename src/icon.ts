// The toolbar icon while a timer runs: the clock on two lines — hours above,
// minutes below, right-aligned in the green square — as the menubar pill
// shows it. Nothing running is the hollow mark, which is a shipped PNG rather
// than a drawing (board #353), so a filled square always means "timing".
// Chrome's badge (the strip under the icon) can only hold four characters,
// rendered tiny and cramped; the desktop's tray pill is the model instead.
//
// The clock is bold monospace text, right-aligned so the two lines share an
// edge and the digits sit in columns. A service worker's canvas has no page
// fonts, and a platform where fillText paints nothing would leave a blank
// green square — so the drawn pixels are checked, and a stroke font of
// digits, "h" and "m" (which cannot fail) takes over when they are empty.

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

/** The 2D-context methods the drawing uses, so a test or a preview page can supply its own. */
export type ClockContext = Pick<
    CanvasRenderingContext2D,
    | 'fillStyle'
    | 'strokeStyle'
    | 'lineWidth'
    | 'lineCap'
    | 'lineJoin'
    | 'font'
    | 'textAlign'
    | 'textBaseline'
    | 'beginPath'
    | 'roundRect'
    | 'fill'
    | 'fillText'
    | 'moveTo'
    | 'lineTo'
    | 'stroke'
    | 'clearRect'
>;

export const CLOCK_GREEN = '#4ca154'; // the mark's green (board #328)

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

/** Where the two lines sit: a shared right edge, one above and one below the middle. */
const RIGHT = 0.88;
const TOP_Y = 0.29;
const BOTTOM_Y = 0.71;

/**
 * A running timer: the clock in the filled square. Bold monospace so the
 * digits are tabular, right-aligned so the two lines share an edge; the
 * stroke font is the fallback for a worker whose canvas paints no text.
 */
export function drawClock(ctx: ClockContext, size: number, lines: ClockLines, mode: 'text' | 'strokes' = 'text'): void {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = CLOCK_GREEN;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();
    const right = size * RIGHT;
    const maxWidth = size * 0.78;
    if (mode === 'text') {
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${size * 0.4}px ui-monospace, Menlo, Consolas, "Liberation Mono", monospace`;
        ctx.fillText(lines.top, right, size * TOP_Y, maxWidth);
        ctx.fillText(lines.bottom, right, size * BOTTOM_Y, maxWidth);
        return;
    }
    // One scale for both lines, so the digits are the same size and the
    // lines share a right edge; small enough that "23h" over "59m" keeps a
    // margin all round at 16px.
    const unit = Math.min((size * 0.3) / GLYPH_HEIGHT, maxWidth / Math.max(textWidth(lines.top), textWidth(lines.bottom)));
    pen(ctx, size, '#fff', 1 / 14);
    for (const [text, cy] of [
        [lines.top, size * TOP_Y],
        [lines.bottom, size * BOTTOM_Y],
    ] as const) {
        strokeAll(ctx, strokesAt(text, right - textWidth(text) * unit, cy - (GLYPH_HEIGHT * unit) / 2, unit));
    }
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

/** Whether anything white was painted over the green: text that never rendered leaves none. */
export const hasInk = (image: ImageData): boolean => {
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 200 && d[i + 2] > 200) return true;
    return false;
};

/** The running clock at every size, or null where there is no canvas to draw on. */
export function clockImages(minutes: number): Record<number, ImageData> | null {
    const lines = clockLines(minutes);
    const text = render((ctx, size) => drawClock(ctx, size, lines, 'text'));
    if (!text) return null;
    // a worker whose canvas cannot reach a font paints the square and nothing else
    return hasInk(text[ICON_SIZES[ICON_SIZES.length - 1]]) ? text : render((ctx, size) => drawClock(ctx, size, lines, 'strokes'));
}

/** The idle icon at every size, or null where there is no canvas to draw on. */
