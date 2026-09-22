// The toolbar icon: the clock as hours over minutes in the green square,
// drawn as strokes when the worker's canvas can reach no font, and the Zebu
// mark in a green outline when nothing runs (board #353).
import { clockLines, drawClock, drawIdle, textWidth, type ClockContext, type Stroke, CLOCK_GREEN } from '../src/icon';

test('the clock splits into an hours line and a minutes line', () => {
    expect(clockLines(0)).toEqual({ top: '0h', bottom: '0m' });
    expect(clockLines(31)).toEqual({ top: '0h', bottom: '31m' });
    expect(clockLines(95)).toEqual({ top: '1h', bottom: '35m' });
    expect(clockLines(600)).toEqual({ top: '10h', bottom: '0m' });
});

test('seconds round to the nearest minute and never go negative', () => {
    expect(clockLines(30.6)).toEqual({ top: '0h', bottom: '31m' });
    expect(clockLines(-4)).toEqual({ top: '0h', bottom: '0m' });
});

const bounds = (strokes: Stroke[]) => {
    const xs = strokes.flat().map(([x]) => x);
    const ys = strokes.flat().map(([, y]) => y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

test('digits are tabular: every one is the same width', () => {
    expect(new Set([...'0123456789'].map((d) => textWidth(d))).size).toBe(1);
});



/** A context that records what was drawn, as strokes of points. */
const recorder = () => {
    const strokes: Stroke[] = [];
    const fills: string[] = [];
    const rects: number[][] = [];
    const texts: { text: string; x: number; y: number }[] = [];
    let current: Stroke = [];
    const ctx: ClockContext = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineCap: 'butt',
        lineJoin: 'miter',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        fillText: (text, x, y) => void texts.push({ text, x, y }),
        beginPath: () => void (current = []),
        roundRect: (...args) => void rects.push(args as number[]),
        fill() {
            fills.push(String(this.fillStyle));
        },
        moveTo: (x, y) => void current.push([x, y]),
        lineTo: (x, y) => void current.push([x, y]),
        stroke: () => void (current.length && strokes.push(current)),
        clearRect: () => undefined,
    };
    return { ctx, strokes, fills, rects, texts };
};

test('a running timer is the clock in monospace, both lines right-aligned on one edge', () => {
    const { ctx, texts, fills } = recorder();

    drawClock(ctx, 32, clockLines(95));

    expect(fills).toEqual([CLOCK_GREEN]);
    expect(ctx.textAlign).toBe('right');
    expect(ctx.font).toContain('monospace');
    expect(texts.map((t) => t.text)).toEqual(['1h', '35m']);
    expect(texts[0].x).toBe(texts[1].x);
    expect(texts[0].y).toBeLessThan(texts[1].y);
});

test('without a font the same lines are stroked, right-aligned and the same size', () => {
    const { ctx, strokes, fills } = recorder();

    drawClock(ctx, 32, clockLines(95), 'strokes');

    expect(fills).toEqual([CLOCK_GREEN]);
    expect(ctx.strokeStyle).toBe('#fff');
    const hours = bounds(strokes.filter((s) => s.every(([, y]) => y < 16)));
    const minutes = bounds(strokes.filter((s) => s.every(([, y]) => y > 16)));
    expect(hours.bottom).toBeLessThan(minutes.top);
    expect(hours.right).toBeCloseTo(minutes.right);
    expect(hours.bottom - hours.top).toBeCloseTo(minutes.bottom - minutes.top);
    expect(minutes.right).toBeLessThanOrEqual(32 * 0.88 + 1e-9);
});

test('nothing running is the mark: an outlined square, the slash, the solid Z', () => {
    const { ctx, strokes, fills, rects } = recorder();

    drawIdle(ctx, 32);

    // The square is an outline and the Z is the only fill, so a filled tile
    // still means a timer is running and nothing else does.
    expect(rects).toHaveLength(1);
    expect(fills).toEqual([CLOCK_GREEN]);

    // The slash runs corner to corner, at half strength so the Z reads over it.
    const slash = strokes.find((s) => s.length === 2);
    expect(slash).toBeDefined();
    const [[x1, y1], [x2, y2]] = slash!;
    expect(Math.abs(x2 - x1)).toBeGreaterThan(32 * 0.4);
    expect(Math.abs(y2 - y1)).toBeGreaterThan(32 * 0.5);
});

test('the mark stays inside its tile at every size Chrome asks for', () => {
    for (const size of [16, 32, 48, 64]) {
        const { ctx, strokes, rects } = recorder();
        drawIdle(ctx, size);

        const [x, y, w, h] = rects[0];
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + w).toBeLessThanOrEqual(size);
        expect(y + h).toBeLessThanOrEqual(size);

        // The slash and the Z are drawn from the artwork's own square, so
        // nothing can wander outside the tile at any scale.
        const inside = (v: number) => v >= 0 && v <= size;
        expect(strokes.flat().every(([sx, sy]) => inside(sx) && inside(sy))).toBe(true);

        // Even at 16px the outline is at least a whole pixel wide.
        expect(ctx.lineWidth).toBeGreaterThanOrEqual(1);
    }
});
