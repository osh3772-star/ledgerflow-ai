import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateFullErpSeed } from '@ledgerflow/test-data';

const fixture = generateFullErpSeed();
const folder = resolve('.ledgerflow');
mkdirSync(folder, { recursive: true });
writeFileSync(resolve(folder, 'seed-full.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ generatorVersion: fixture.generatorVersion, seed: fixture.seed, ...fixture.manifest,
  counts: { counterparties: fixture.counterparties.length, contracts: fixture.contracts.length, invoices: fixture.invoices.length,
    inventoryMovements: fixture.inventoryMovements.length, bankTransactions: fixture.bankTransactions.length, adjustments: fixture.adjustments.length } }, null, 2));
