import {describe,expect,it} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {parseEnv} from 'node:util';
import {initializeSessionKey} from '../../scripts/session-key.js';
const base=resolve('.ledgerflow/tmp');
async function withEnv(content:string,run:(file:string)=>Promise<void>){
  await mkdir(base,{recursive:true});const directory=await mkdtemp(base+sep+'session-key-'),file=resolve(directory,'.env.local');
  try{await writeFile(file,content);await run(file);}
  finally{if(!directory.startsWith(base+sep))throw new Error('Invalid test directory');await rm(directory,{recursive:true,force:true});}
}
describe('write-only session key preparation',()=>{
  it('appends a random key without rewriting existing provider settings or returning values',async()=>{
    const original='NTS_SERVICE_KEY=fixture-provider-value\nLEDGERFLOW_SESSION_ENCRYPTION_KEY=\n';
    await withEnv(original,async file=>{
      const report=await initializeSessionKey(file),content=await readFile(file,'utf8'),key=parseEnv(content).LEDGERFLOW_SESSION_ENCRYPTION_KEY!;
      expect(content.startsWith(original)).toBe(true);expect(Buffer.from(key,'base64')).toHaveLength(32);
      expect(report).toEqual({created:true,configured:true,existingKeyPreserved:false});expect(JSON.stringify(report)).not.toContain(key);
    });
  });
  it('preserves a valid existing key and refuses to overwrite an invalid one',async()=>{
    for(const key of [Buffer.alloc(32,7).toString('base64'),'private-invalid-fixture']){
      const original='LEDGERFLOW_SESSION_ENCRYPTION_KEY='+key+'\n';
      await withEnv(original,async file=>{
        if(key==='private-invalid-fixture')await expect(initializeSessionKey(file)).rejects.toThrow('canonical base64');
        else expect(await initializeSessionKey(file)).toMatchObject({created:false,existingKeyPreserved:true});
        expect(await readFile(file,'utf8')).toBe(original);await expect(access(file+'.lock')).rejects.toThrow();
      });
    }
  });
  it('does not bypass an existing file lock or change unrelated settings',async()=>{
    const original='DART_API_KEY=fixture-provider\n';
    await withEnv(original,async file=>{
      await writeFile(file+'.lock','owned by another test');
      await expect(initializeSessionKey(file)).rejects.toThrow();
      expect(await readFile(file,'utf8')).toBe(original);expect(await readFile(file+'.lock','utf8')).toBe('owned by another test');
    });
  });
});
