// The running-timer toolbar icon: hours over minutes, in the green square.
import { clockLines, drawClock, type ClockContext } from '../src/icon';

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

test('both lines are drawn centred, hours above minutes, on the green square', () => {
    const texts: { text: string; x: number; y: number }[] = [];
    const fills: string[] = [];
    const ctx: ClockContext = {
        fillStyle: '',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        beginPath: () => undefined,
        roundRect: () => undefined,
        fill() {
            fills.push(String(this.fillStyle));
        },
        clearRect: () => undefined,
        fillText: (text, x, y) => texts.push({ text, x, y }),
    };

    drawClock(ctx, 32, clockLines(95));

    expect(fills).toEqual(['#197300']);
    expect(texts.map((t) => t.text)).toEqual(['1h', '35m']);
    expect(texts.every((t) => t.x === 16)).toBe(true);
    expect(texts[0].y).toBeLessThan(texts[1].y);
    expect(ctx.textAlign).toBe('center');
});
