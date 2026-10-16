import {describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {buildInitialMigrationBundle,applyInitialSchema} from '../../scripts/supabase-initialization.js';

describe('explicit initial schema manifest',()=>{
  it('binds all six original migration files and strips only their outer transaction wrappers',async()=>{
    const first=await buildInitialMigrationBundle(),second=await buildInitialMigrationBundle();
    expect(first).toEqual(second);expect(first.migrations).toHaveLength(6);
    expect(first.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.body).not.toMatch(/^BEGIN;|^COMMIT;/mu);
    expect(first.body).toContain('CREATE TABLE public.journal_entries');
    expect(first.body).not.toContain('INSERT INTO auth.users');
  });
  it('refuses a stale hash or modified bundle before beginning any transaction',async()=>{
    const bundle=await buildInitialMigrationBundle(),query=vi.fn();
    const client={query} as unknown as PoolClient;
    await expect(applyInitialSchema(client,bundle,'0'.repeat(64))).rejects.toThrow('INITIAL_MIGRATION_HASH_MISMATCH');
    await expect(applyInitialSchema(client,{...bundle,body:bundle.body+'\nSELECT 1;'},bundle.bundleHash))
      .rejects.toThrow('INITIAL_MIGRATION_HASH_MISMATCH');
    expect(query).not.toHaveBeenCalled();
  });
});
