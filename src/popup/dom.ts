// The one DOM helper the popup is written with: a tag, its attributes, its children.
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
};

/** An inline SVG icon drawn from `paths`, so it never picks up an emoji face the way a glyph can. */
export const svg = (className: string, size: number, inner: string): SVGSVGElement => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', className);
    icon.setAttribute('viewBox', '0 0 14 14');
    icon.setAttribute('width', String(size));
    icon.setAttribute('height', String(size));
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = inner;
    return icon;
};

export const ICON_CHART = '<rect x="1" y="7" width="3" height="6" rx="1"/><rect x="5.5" y="4" width="3" height="9" rx="1"/><rect x="10" y="1" width="3" height="12" rx="1"/>';
// outlined, like the ☆ beside it, and drawn to the same size (board #359): the ⚙ glyph came out at two thirds of it
export const ICON_GEAR =
    '<path d="M11.68 5.55L13.17 5.75L13.17 8.25L11.68 8.45L11.33 9.29L12.25 10.48L10.48 12.25L9.29 11.33L8.45 11.68L8.25 13.17L5.75 13.17L5.55 11.68L4.71 11.33L3.52 12.25L1.75 10.48L2.67 9.29L2.32 8.45L0.83 8.25L0.83 5.75L2.32 5.55L2.67 4.71L1.75 3.52L3.52 1.75L4.71 2.67L5.55 2.32L5.75 0.83L8.25 0.83L8.45 2.32L9.29 2.67L10.48 1.75L12.25 3.52L11.33 4.71Z"/><circle cx="7" cy="7" r="2"/>';
export const ICON_PENCIL = '<path d="M9.55 1.35a1.35 1.35 0 0 1 1.9 1.9l-.62.62-1.9-1.9.62-.62ZM8.22 2.68l1.9 1.9-5.26 5.26-2.4.5.5-2.4 5.26-5.26Z"/>';
