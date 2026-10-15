import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {ErpService} from '@ledgerflow/application-services';
import {PostgresErpRepository} from '@ledgerflow/data-access';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';

it('upgrades an already populated P2-B2 database without losing transactions/evidence or reopening closed periods',async()=>{
  const db=await startLocalPostgres({throughMigration:'202610140002_erp_subledgers.sql'});
  try{
    const seed=generateFullErpSeed(),company=seed.companies[0]!.id;
    await seedFullDatabase(db.pool,seed);
    const january=seed.periods.find((row)=>row.companyId===company&&row.start==='2026-01-01')!;
    await db.pool.query("UPDATE public.fiscal_periods SET status='closed' WHERE id=$1",[january.id]);
    const before=await db.pool.query('SELECT id,payload_hash FROM public.business_transactions ORDER BY id');
    await db.pool.query(await readFile(resolve('supabase/migrations/202610140003_erp_services.sql'),'utf8'));
    expect((await db.pool.query('SELECT id,payload_hash FROM public.business_transactions ORDER BY id')).rows).toEqual(before.rows);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.transaction_documents')).rows[0].count).toBe(1001);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.source_documents')).rows[0].count).toBe(1001);
    expect((await db.pool.query('SELECT status FROM public.fiscal_periods WHERE id=$1',[january.id])).rows[0].status).toBe('closed');
    const identity=seed.identities.find((row)=>row.companyId===company&&row.role==='preparer')!;
    const service=new ErpService(new PostgresErpRepository(db.pool,identity.userId));
    expect((await service.getInvoices({companyId:company,from:'2026-01-01',to:'2026-01-31',direction:'sales'})).items).toHaveLength(20);
  }finally{await db.stop();}
},60_000);
