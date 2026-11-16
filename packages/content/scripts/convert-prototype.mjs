// Converts the prototype's data/*.js (window.CONTENT / SENTENCES / CUSTOM) into JSON seed files.
// Usage: node packages/content/scripts/convert-prototype.mjs <path-to-Punjabi-Flash-Cards>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = resolve(process.argv[2] || '../Punjabi-Flash-Cards');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
mkdirSync(out, { recursive: true });

const window = {};
const ctx = vm.createContext({ window });
for (const f of ['content.js', 'sentences.js', 'custom.js']) vm.runInContext(readFileSync(join(src, 'data', f), 'utf8'), ctx, { filename: f });

const write = (name, data) => { writeFileSync(join(out, name), JSON.stringify(data, null, 1) + '\n'); console.log('wrote', name); };
write('content.json', window.CONTENT);
write('sentences.json', window.SENTENCES);
write('custom.json', window.CUSTOM);
console.log('letters', window.CONTENT.letters.length, 'vocab', window.CONTENT.vocab.length, 'phrases', window.CONTENT.phrases.length);
