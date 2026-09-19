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
export const ICON_PENCIL = '<path d="M9.55 1.35a1.35 1.35 0 0 1 1.9 1.9l-.62.62-1.9-1.9.62-.62ZM8.22 2.68l1.9 1.9-5.26 5.26-2.4.5.5-2.4 5.26-5.26Z"/>';
