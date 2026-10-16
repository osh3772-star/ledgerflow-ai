import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {PostgresAccountingRepository} from '@ledgerflow/data-access';
import {AccountingService,AccountingReferenceService} from '@ledgerflow/application-services';
import {PublicDataService} from '@ledgerflow/public-data';
import {generateJournal} from '@ledgerflow/accounting-core';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';

describe('public-reference snapshots on a test-owned disposable PostgreSQL',()=>{
  const seed=generateFullErpSeed(),company=seed.companies[0]!.id,writer=seed.identities.find(i=>i.companyId===company&&i.role==='viewer')!,human=seed.identities.find(i=>i.companyId===company&&i.role==='preparer')!;
  const review=new AccountingReferenceService(new PublicDataService({},'mock'));
  let db:Awaited<ReturnType<typeof startLocalPostgres>>,service:AccountingService,approver:AccountingService;
  beforeAll(async()=>{
    db=await startLocalPostgres();await seedFullDatabase(db.pool,seed);
    await db.pool.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3),($1,$4,$5)',[company,writer.principalId,'accounting:write',human.principalId,'accounting:approve']);
    service=new AccountingService(new PostgresAccountingRepository(db.pool,writer.userId),review);
    approver=new AccountingService(new PostgresAccountingRepository(db.pool,human.userId));
  });
  afterAll(async()=>{if(db)await db.stop();});
  it('hashes references with the draft, preserves exact lines and requires independent approval',async()=>{
    const transaction=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!,q={companyId:company,transactionId:transaction.id,idempotencyKey:'references/1'};
    const source=await service.repository.source(company,transaction.id),j=await service.propose(q);
    expect(j.payload.lines).toEqual(generateJournal(source).lines);
    expect(j.payload.publicReferences?.items).toHaveLength(4);
    expect((await service.get({companyId:company,journalId:j.id})).payload.publicReferences).toEqual(j.payload.publicReferences);
    await expect(service.repository.save(company,{...j.payload,publicReferences:{...j.payload.publicReferences!,preparedAt:'2020-01-01T00:00:00.000Z'}},q.idempotencyKey)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await service.validate({companyId:company,journalId:j.id});await service.requestApproval({companyId:company,journalId:j.id});
    await expect(service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    await expect(service.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'});
    expect((await service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).state).toBe('Posted');
    expect((await service.get({companyId:company,journalId:j.id})).payload.publicReferences).toEqual(j.payload.publicReferences);
  });
  it('returns the first immutable draft for concurrent requests with different reference times',async()=>{
    const transaction=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0102')!,q={companyId:company,transactionId:transaction.id,idempotencyKey:'references/concurrent'};
    const original=review.collect.bind(review);let count=0;let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const spy=vi.spyOn(review,'collect').mockImplementation(async source=>{
      const report=await original(source),sequence=++count;if(sequence===2)release();await gate;
      return {...report,preparedAt:new Date(1767225600000+sequence).toISOString()};
    });
    try{const [first,second]=await Promise.all([service.propose(q),service.propose(q)]);
      expect(count).toBe(2);expect(first.id).toBe(second.id);expect(first.hash).toBe(second.hash);
      expect(first.payload.publicReferences).toEqual(second.payload.publicReferences);
    }finally{spy.mockRestore();}
  });
  it('allows old payloads without references and rejects a mismatched review date',async()=>{
    const transaction=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0103')!,q={companyId:company,transactionId:transaction.id,idempotencyKey:'references/legacy'};
    const legacy=new AccountingService(service.repository),j=await legacy.propose(q);expect(j.payload).not.toHaveProperty('publicReferences');
    expect((await legacy.validate({companyId:company,journalId:j.id})).state).toBe('Validated');
    const report=await review.collect(await service.repository.source(company,transaction.id));
    const mismatched=await service.repository.save(company,{...j.payload,publicReferences:{...report,transactionDate:'2026-01-31'}},'references/date-mismatch');
    await expect(service.validate({companyId:company,journalId:mismatched.id})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  });
});
