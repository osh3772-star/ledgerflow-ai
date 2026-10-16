import {mkdir,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {describe,expect,it} from 'vitest';
import {databasePoolOptions} from '../../scripts/postgres-connection.js';

const hosted='postgresql://postgres.abcdefghijklmnopqrst:fixture%23password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
describe('shared hosted PostgreSQL TLS configuration',()=>{
  it('preserves the existing local database connection profile',async()=>{
    const url='postgresql://postgres:fixture@127.0.0.1:12345/postgres';
    expect(await databasePoolOptions({LEDGERFLOW_DATABASE_URL:url})).toMatchObject({connectionString:url,max:4,application_name:'ledgerflow-mcp'});
  });
  it('verifies hosted peers without a connectionString that could override ssl settings',async()=>{
    const result=await databasePoolOptions({LEDGERFLOW_DATABASE_URL:hosted+'?sslmode=require'});
    expect(result).toMatchObject({host:'aws-0-ap-southeast-1.pooler.supabase.com',port:5432,
      user:'postgres.abcdefghijklmnopqrst',password:'fixture#password',ssl:{rejectUnauthorized:true}});
    expect(result).not.toHaveProperty('connectionString');
  });
  it('refuses insecure or unsupported URL TLS options without echoing the URL',async()=>{
    for(const query of ['sslmode=disable','sslmode=no-verify','ssl=false','sslkey=private-key.pem']){
      await expect(databasePoolOptions({LEDGERFLOW_DATABASE_URL:hosted+'?'+query})).rejects.toThrow('HOSTED_DATABASE_TLS_OPTIONS_INVALID');
    }
    await expect(databasePoolOptions({LEDGERFLOW_DATABASE_URL:'private-malformed-url'})).rejects.toThrow('DATABASE_URL_INVALID');
    await expect(databasePoolOptions({LEDGERFLOW_DATABASE_URL:hosted,LEDGERFLOW_DATABASE_CA_FILE:'.ledgerflow/certs/unavailable.crt'})).rejects.toThrow('DATABASE_CA_INVALID');
  });
  it('uses an explicitly supplied public CA and fails closed on invalid certificate content',async()=>{
    const base=resolve('.ledgerflow/tmp');await mkdir(base,{recursive:true});
    const directory=await mkdtemp(join(base,'ca-')),file=join(directory,'root.crt');
    try{
      await writeFile(file,rootCertificates[0]!);
      const result=await databasePoolOptions({LEDGERFLOW_DATABASE_URL:hosted+'?sslmode=verify-full',LEDGERFLOW_DATABASE_CA_FILE:file});
      expect(result.ssl).toEqual({rejectUnauthorized:true,ca:rootCertificates[0]});
      await writeFile(file,'private-invalid-content');
      await expect(databasePoolOptions({LEDGERFLOW_DATABASE_URL:hosted,LEDGERFLOW_DATABASE_CA_FILE:file})).rejects.toThrow('DATABASE_CA_INVALID');
    }finally{await unlink(file);await rmdir(directory);}
  });
});
