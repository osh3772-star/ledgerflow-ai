import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
const { Pool } = pg;

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Cannot allocate local port.'));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}
function assertOwnedTempDirectory(base: string, directory: string) {
  const normalizedBase = resolve(base);
  const normalized = resolve(directory);
  if (!normalized.startsWith(normalizedBase + sep) || normalized === normalizedBase) {
    throw new Error('Refusing to delete a directory outside LedgerFlow temporary data.');
  }
}
export async function startLocalPostgres(options: { throughMigration?: string } = {}) {
  const base = resolve('.ledgerflow/tmp');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(base + sep + 'pg-');
  assertOwnedTempDirectory(base, directory);
  const port = await freePort();
  const password = randomBytes(24).toString('hex');
  const cluster = new EmbeddedPostgres({
    databaseDir: directory, port, user: 'postgres', password,
    persistent: true, createPostgresUser: false, authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  const pool = new Pool({
    host: '127.0.0.1', port, user: 'postgres', password,
    database: 'postgres', max: 4, connectionTimeoutMillis: 10_000,
  });
  let started = false;
  try {
    await cluster.initialise();
    await cluster.start();
    started = true;
    const client = await pool.connect();
    try {
      await client.query(await readFile(resolve('tests/support/auth-bootstrap.sql'), 'utf8'));
      const migrationDirectory = resolve('supabase/migrations');
      const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
      const stopIndex=options.throughMigration?migrations.indexOf(options.throughMigration):migrations.length-1;
      if(stopIndex<0)throw new Error('Requested local migration checkpoint was not found.');
      for (const migration of migrations.slice(0,stopIndex+1)) await client.query(await readFile(resolve(migrationDirectory, migration), 'utf8'));
    } finally { client.release(); }
    return {
      pool,
      async stop() {
        await pool.end();
        await cluster.stop();
        assertOwnedTempDirectory(base, directory);
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      },
    };
  } catch (error) {
    await pool.end();
    if (started) await cluster.stop();
    assertOwnedTempDirectory(base, directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}
