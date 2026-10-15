import { describe,expect,it } from 'vitest';
import { createTransactionSchema,evidenceSchema,invoiceQuerySchema,bankQuerySchema,counterpartyQuerySchema,unprocessedQuerySchema } from '@ledgerflow/contracts';
import { generateFullErpSeed } from '@ledgerflow/test-data';
const seed=generateFullErpSeed();
const input={companyId:seed.companies[0]!.id,idempotencyKey:'unit-create-1',externalRef:'unit-create-1',kind:'sale',currency:'KRW',
  occurredOn:'2026-12-30',recognitionOn:'2026-12-30',net:'100',tax:'10',gross:'110',
  documents:[{documentType:'synthetic_invoice',issueDate:'2026-12-30',content:{origin:'synthetic_erp',description:'한글 증빙 📄',quantity:1}}]};
describe('ERP service input boundary',()=>{
  it('normalizes exact whole-won decimal strings and requires one evidence mode',()=>{
    expect(createTransactionSchema.parse({...input,net:'100.000000'}).net).toBe('100');
    expect(createTransactionSchema.safeParse({...input,documentIds:[seed.documents[0]!.id]}).success).toBe(false);
    const {documents:_,...without}=input;
    expect(createTransactionSchema.safeParse(without).success).toBe(false);
    expect(createTransactionSchema.safeParse({...without,documentIds:[seed.documents[0]!.id,seed.documents[0]!.id]}).success).toBe(false);
  });
  it.each([{gross:'111'},{net:'0.1',tax:'0',gross:'0.1'},{net:'-1',tax:'0',gross:'-1'},{net:100},{currency:'USD'}])('rejects invalid accounting source amounts %j',(patch)=>{
    expect(createTransactionSchema.safeParse({...input,...patch}).success).toBe(false);
  });
  it.each(['id','actorUserId','periodId','status','origin','payloadHash','posted'])('rejects client-controlled %s',(field)=>{
    expect(createTransactionSchema.safeParse({...input,[field]:'injected'}).success).toBe(false);
  });
  it('rejects unsafe evidence numbers, invalid field names, oversized and overly deep JSON',()=>{
    const original=input.documents[0]!;
    for(const content of [
      {origin:'synthetic_erp',amount:0.1},{origin:'synthetic_erp',amount:9007199254740992},
      {origin:'synthetic_erp',description:'\u0000'},{origin:'public_api_live'},
      {origin:'synthetic_erp','bad-key':1},{origin:'synthetic_erp',description:'a'.repeat(17000)},
    ])expect(evidenceSchema.safeParse({...original,content}).success).toBe(false);
    let nested:unknown=1;for(let i=0;i<9;i++)nested={nested};
    expect(evidenceSchema.safeParse({...original,content:{origin:'synthetic_erp',nested}}).success).toBe(false);
  });
  it('bounds range/page filters and treats search text as literal input',()=>{
    const range={companyId:input.companyId,from:'2026-01-01',to:'2026-12-31'};
    expect(invoiceQuerySchema.safeParse({...range,direction:'sale'}).success).toBe(false);
    expect(invoiceQuerySchema.safeParse({...range,from:'2027-01-01'}).success).toBe(false);
    expect(bankQuerySchema.safeParse({...range,limit:101}).success).toBe(false);
    expect(unprocessedQuerySchema.safeParse({...range,status:'processed'}).success).toBe(false);
    expect(counterpartyQuerySchema.parse({companyId:input.companyId,query:"  %' OR 1=1 --  "}).query).toBe("%' OR 1=1 --");
  });
});
