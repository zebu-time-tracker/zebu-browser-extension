// Every locale under _locales must carry exactly the English keys, with the
// same $1/$2 placeholders. Run `npm run i18n:check`.
import { readdirSync, readFileSync } from 'node:fs';

const load = (locale) => JSON.parse(readFileSync(`_locales/${locale}/messages.json`, 'utf8'));
const en = load('en');
const placeholders = (s) => (s.match(/\$\d/g) ?? []).sort().join(',');

let failures = 0;
for (const locale of readdirSync('_locales').filter((l) => l !== 'en')) {
    const messages = load(locale);
    for (const key of Object.keys(en)) {
        if (!messages[key]) {
            console.log(`FAIL ${locale}: missing ${key}`);
            failures++;
        } else if (placeholders(messages[key].message) !== placeholders(en[key].message)) {
            console.log(`FAIL ${locale}: ${key} placeholders differ`);
            failures++;
        }
    }
    for (const key of Object.keys(messages)) {
        if (!en[key]) {
            console.log(`FAIL ${locale}: extra key ${key}`);
            failures++;
        }
    }
}
console.log(`i18n:check — ${readdirSync('_locales').length} locales × ${Object.keys(en).length} keys; ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
