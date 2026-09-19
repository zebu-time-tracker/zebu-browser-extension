// The toolbar icon while a timer runs: the green square with the clock on two
// lines — hours above, minutes below — drawn as pixels. Chrome's badge (the
// strip under the icon) can only hold four characters, rendered tiny and
// cramped; the desktop's tray pill is the model instead.

export interface ClockLines {
    top: string;
    bottom: string;
}

/** Whole minutes on the clock → the two lines: "1h" over "35m". */
export function clockLines(minutes: number): ClockLines {
    const m = Math.max(0, Math.round(minutes));
    return { top: `${Math.floor(m / 60)}h`, bottom: `${m % 60}m` };
}

/** The 2D-context methods the drawing uses, so a test or a preview page can supply its own. */
export type ClockContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textAlign' | 'textBaseline' | 'beginPath' | 'roundRect' | 'fill' | 'fillText' | 'clearRect'>;

export const CLOCK_GREEN = '#197300';

export function drawClock(ctx: ClockContext, size: number, lines: ClockLines): void {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = CLOCK_GREEN;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Small type, with a margin all round: "23h" over "59m" must sit inside
    // the square at 16px without touching its edges or each other.
    ctx.font = `bold ${size * 0.36}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(lines.top, size / 2, size * 0.3, size - 4);
    ctx.fillText(lines.bottom, size / 2, size * 0.7, size - 4);
}

/** The sizes Chrome asks the action icon for, at 1x through 4x. */
export const ICON_SIZES = [16, 32, 48, 64];

/** The icon at every size, or null where there is no canvas to draw on. */
export function clockImages(minutes: number): Record<number, ImageData> | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const lines = clockLines(minutes);
    const images: Record<number, ImageData> = {};
    for (const size of ICON_SIZES) {
        const ctx = new OffscreenCanvas(size, size).getContext('2d');
        if (!ctx) return null;
        drawClock(ctx, size, lines);
        images[size] = ctx.getImageData(0, 0, size, size);
    }
    return images;
}
