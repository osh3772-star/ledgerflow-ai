import {generateFullErpSeed} from '@ledgerflow/test-data';
import {ErpService} from '@ledgerflow/application-services';
import {PostgresErpRepository} from '@ledgerflow/data-access';
import {startLocalPostgres} from './local-postgres.js';
import {seedFullDatabase} from './seed-full-database.js';

const db=await startLocalPostgres();
try{
  const seed=generateFullErpSeed(),companyId=seed.companies[0]!.id;
  await seedFullDatabase(db.pool,seed);
  const identity=seed.identities.find((row)=>row.companyId===companyId&&row.role==='preparer')!;
  const service=new ErpService(new PostgresErpRepository(db.pool,identity.userId));
  const query={companyId,from:'2026-01-01',to:'2026-01-31'};
  const sales=await service.getInvoices({...query,direction:'sales'});
  const banks=await service.getBankTransactions({...query,unmatchedOnly:true});
  const stock=await service.getInventory({companyId,asOf:'2026-01-31',productId:seed.products[0]!.id});
  const parties=await service.getCounterparties({companyId,query:'거래처 01'});
  const input={companyId,idempotencyKey:'demo-services-v1',externalRef:'DEMO-SERVICE-001',kind:'sale',currency:'KRW',
    occurredOn:'2026-12-30',recognitionOn:'2026-12-30',counterpartyId:seed.counterparties[0]!.id,
    net:'100000',tax:'10000',gross:'110000',documents:[{documentType:'synthetic_invoice',issueDate:'2026-12-30',
      content:{origin:'synthetic_erp',externalRef:'DEMO-SERVICE-001',description:'서비스 데모용 가상 증빙'}}]};
  const created=await service.createTransaction(input),repeated=await service.createTransaction(input);
  const pending=await service.getUnprocessedTransactions({companyId,from:'2026-12-30',to:'2026-12-30'});
  console.log(JSON.stringify({phase:'P2-C',database:'native_local_postgresql',supabaseStackVerified:false,apiCalls:0,aiCalls:0,
    januarySales:sales.items.length,januaryUnallocatedCash:banks.items.length,januarySku1:stock.items[0],counterparties:parties.items.length,
    creation:created,replay:{sameTransaction:created.transaction.id===repeated.transaction.id,reused:repeated.reused},
    newTransactionPending:pending.items.some((row)=>row.id===created.transaction.id)},null,2));
}finally{await db.stop();}
