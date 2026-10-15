import { mkdir, writeFile } from 'node:fs/promises';
import { generateMiniSeed } from '@ledgerflow/test-data';
import { resolve } from 'node:path';

const data = generateMiniSeed();
await mkdir(resolve('.ledgerflow'), { recursive: true });
const file = resolve('.ledgerflow/seed-mini.json');
await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file, origin: 'synthetic_erp', ...data.manifest }, null, 2));
