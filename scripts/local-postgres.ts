import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
const { Pool } = pg;

function runPgCtl(executable: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    // The background server can inherit pg_ctl pipes on Windows. Waiting for
    // their EOF delays execFile completion until its timeout, after a healthy
    // start. pg_ctl -w confirms readiness; logs go to the owned server.log.
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true, timeout });
    child.once('error', () => reject(new Error('PG_CTL_FAILED')));
    child.once('exit', (code) => code === 0 ? resolveCommand() : reject(new Error('PG_CTL_FAILED')));
  });
}

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
export async function startLocalPostgres(options: { throughMigration?: string | null } = {}) {
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
  let pgCtl: string | undefined;
  async function stopCluster() {
    if (!pgCtl) { await cluster.stop(); return; }
    // pg_ctl can reject after spawning a server. Check only our owned pid file
    // before cleanup, including the failed-start path; never stop a shared DB.
    try { await stat(resolve(directory, 'postmaster.pid')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await runPgCtl(pgCtl, ['stop', '-D', directory, '-m', 'fast', '-w', '-t', '15'], 20_000);
  }
  let started = false;
  try {
    await cluster.initialise();
    if (process.platform === 'win32') {
      // Use the binary dependency resolved by the pinned embedded-postgres
      // package. pg_ctl starts postgres with a restricted Windows token, which
      // direct postgres.exe invocation cannot do on an elevated CI runner.
      const nativeRequire = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
      const binary = await import(pathToFileURL(nativeRequire.resolve('@embedded-postgres/windows-x64')).href) as { pg_ctl: string };
      pgCtl = binary.pg_ctl;
      await runPgCtl(pgCtl, ['start', '-D', directory, '-l', resolve(directory, 'server.log'),
        '-o', '-h 127.0.0.1 -p ' + port, '-w', '-t', '30'],
      35_000);
    } else await cluster.start();
    started = true;
    const client = await pool.connect();
    try {
      await client.query(await readFile(resolve('tests/support/auth-bootstrap.sql'), 'utf8'));
      const migrationDirectory = resolve('supabase/migrations');
      const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
      // null is a fresh, test-owned Auth harness for initial migration tests.
      const stopIndex=options.throughMigration===null?-1:options.throughMigration?migrations.indexOf(options.throughMigration):migrations.length-1;
      if(options.throughMigration!==null&&stopIndex<0)throw new Error('Requested local migration checkpoint was not found.');
      for (const migration of migrations.slice(0,stopIndex+1)) await client.query(await readFile(resolve(migrationDirectory, migration), 'utf8'));
    } finally { client.release(); }
    return {
      pool,
      async stop() {
        await pool.end();
        await stopCluster();
        assertOwnedTempDirectory(base, directory);
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      },
    };
  } catch (error) {
    await pool.end();
    if (started || pgCtl) await stopCluster();
    assertOwnedTempDirectory(base, directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}
