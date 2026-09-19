// The toolbar icon: the clock as hours over minutes in the green square, the
// Z in a green outline when nothing runs — drawn as strokes so it never
// depends on a font the worker cannot reach.
import { clockLines, drawClock, drawIdle, textStrokes, textWidth, type ClockContext, type Stroke } from '../src/icon';

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

test('a line is centred and kept inside its width, however long it is', () => {
    const short = bounds(textStrokes('0h', 16, 8, 8, 24));
    expect(short.left + short.right).toBeCloseTo(32);
    expect(short.top).toBeCloseTo(4);
    expect(short.bottom).toBeCloseTo(12);

    // "59m" is the widest line: it shrinks to the width rather than spilling over
    const wide = bounds(textStrokes('59m', 16, 8, 8, 12));
    expect(wide.left).toBeGreaterThanOrEqual(10);
    expect(wide.right).toBeLessThanOrEqual(22);
    expect(wide.bottom - wide.top).toBeLessThan(8);
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

    expect(fills).toEqual(['#197300']);
    expect(ctx.textAlign).toBe('right');
    expect(ctx.font).toContain('monospace');
    expect(texts.map((t) => t.text)).toEqual(['1h', '35m']);
    expect(texts[0].x).toBe(texts[1].x);
    expect(texts[0].y).toBeLessThan(texts[1].y);
});

test('without a font the same lines are stroked, right-aligned and the same size', () => {
    const { ctx, strokes, fills } = recorder();

    drawClock(ctx, 32, clockLines(95), 'strokes');

    expect(fills).toEqual(['#197300']);
    expect(ctx.strokeStyle).toBe('#fff');
    const hours = bounds(strokes.filter((s) => s.every(([, y]) => y < 16)));
    const minutes = bounds(strokes.filter((s) => s.every(([, y]) => y > 16)));
    expect(hours.bottom).toBeLessThan(minutes.top);
    expect(hours.right).toBeCloseTo(minutes.right);
    expect(hours.bottom - hours.top).toBeCloseTo(minutes.bottom - minutes.top);
    expect(minutes.right).toBeLessThanOrEqual(32 * 0.88 + 1e-9);
});

test('nothing running is the Z in a green outline, nothing filled', () => {
    const { ctx, strokes, fills, rects } = recorder();

    drawIdle(ctx, 32);

    expect(fills).toEqual([]);
    expect(ctx.strokeStyle).toBe('#197300');
    expect(rects).toHaveLength(1);
    expect(strokes.length).toBeGreaterThan(0);
});
