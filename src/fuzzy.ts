// Small, dependency-free fuzzy matching for the presets list, the same
// algorithm as the desktop's src/fuzzy.ts and the web app's fuzzy.ts:
//
//   - every query word must match: word-prefix > substring > in-order subsequence
//   - shorter haystacks win ties

const normalize = (s: string) =>
    s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

const subsequence = (needle: string, hay: string): boolean => {
    let i = 0;
    for (const ch of hay) {
        if (ch === needle[i]) i++;
        if (i === needle.length) return true;
    }
    return needle.length === 0;
};

export function fuzzyScore(query: string, text: string): number | null {
    const q = normalize(query).trim();
    if (!q) return 0;
    const hay = normalize(text);
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;

    for (const part of q.split(/\s+/)) {
        if (words.some((w) => w.startsWith(part))) score += 3;
        else if (hay.includes(part)) score += 2;
        else if (subsequence(part, hay.replace(/[^a-z0-9]/g, ''))) score += 1;
        else return null;
    }

    return score * 1000 - hay.length;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
    if (!query.trim()) return items;
    return items
        .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
        .filter((r): r is { item: T; score: number } => r.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.item);
}
