import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';
describe('Storage policy SQL on PostgreSQL stand-in tables (not hosted Storage)',()=>{
 let db:Awaited<ReturnType<typeof startLocalPostgres>>;
 const seed=generateFullErpSeed(),company=seed.companies[0]!.id,foreign=seed.companies[1]!.id;
 const reader=seed.identities.find(i=>i.companyId===company&&i.role==='viewer')!,writer=seed.identities.find(i=>i.companyId===company&&i.role==='preparer')!;
 const other=seed.identities.find(i=>i.companyId===foreign&&i.role==='preparer')!;
 beforeAll(async()=>{
  db=await startLocalPostgres({throughMigration:'202610140004_accounting.sql'});
  await seedFullDatabase(db.pool,seed);
  // Referenced policy columns only; no hosted Storage/JWT emulation.
  await db.pool.query('CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated');
  await db.pool.query(await readFile('supabase/migrations/202610140005_controls.sql','utf8'));
 });
 afterAll(async()=>{if(db)await db.stop();});
 async function scoped(userId:string,sql:string,values:unknown[]=[]){
  const c=await db.pool.connect();
  try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);const result=await c.query(sql,values);await c.query('COMMIT');return result;}
  catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 it('creates a private bounded evidence bucket',async()=>{
  expect((await db.pool.query("SELECT public,file_size_limit FROM storage.buckets WHERE id='ledgerflow-evidence'")).rows[0]).toMatchObject({public:false,file_size_limit:'10485760'});
 });
 it('allows scoped writers and isolates company reads',async()=>{
  await scoped(writer.userId,'INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['ledgerflow-evidence',company+'/fixture.json']);
  expect((await scoped(reader.userId,'SELECT name FROM storage.objects')).rows).toHaveLength(1);
  expect((await scoped(other.userId,'SELECT name FROM storage.objects')).rows).toHaveLength(0);
 });
 it('rejects reader writes, foreign prefixes and malformed UUIDs without unsafe casts',async()=>{
  for(const [userId,path] of [[reader.userId,company+'/denied.json'],[writer.userId,foreign+'/denied.json'],[writer.userId,'------------------------------------/denied.json']]){
    await expect(scoped(userId!,'INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['ledgerflow-evidence',path])).rejects.toThrow('row-level security');
  }
 });
});
