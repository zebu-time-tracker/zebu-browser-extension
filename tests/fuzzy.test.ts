import { fuzzyFilter, fuzzyScore } from '../src/fuzzy';

const projects = ['WEB: Website (Acme)', "PMD: Placemat & Menu Design (Bob's Waffles)", 'Acme Holdings Europe internal', 'Design retainer (Globex)'];

test('word prefixes beat substrings beat subsequences', () => {
    expect(fuzzyFilter(projects, 'des', (p) => p).slice(0, 2)).toEqual(['Design retainer (Globex)', "PMD: Placemat & Menu Design (Bob's Waffles)"]);
    expect(fuzzyFilter(projects, 'pmd', (p) => p)[0]).toBe("PMD: Placemat & Menu Design (Bob's Waffles)");
    expect(fuzzyFilter(projects, 'acme', (p) => p)[0]).toBe('WEB: Website (Acme)');
});

test('every query word must match, accents and case are ignored, empty query keeps everything', () => {
    expect(fuzzyScore('menu waffles', "PMD: Placemat & Menu Design (Bob's Waffles)")).not.toBeNull();
    expect(fuzzyScore('menu globex', "PMD: Placemat & Menu Design (Bob's Waffles)")).toBeNull();
    expect(fuzzyScore('resume', 'Résumé site')).not.toBeNull();
    expect(fuzzyFilter(projects, '   ', (p) => p)).toHaveLength(projects.length);
});
