import {open,readFile,appendFile,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {validateSessionEncryptionKey} from '../apps/mcp-server/src/human-session-store.js';

// Call only with an ignored server env file. Never return key values/content.
export async function initializeSessionKey(file:string){
  const lockPath=file+'.lock';
  const lock=await open(lockPath,'wx',0o600);
  try{
    const original=await readFile(file,'utf8'),environment=parseEnv(original);
    const existing=environment.LEDGERFLOW_SESSION_ENCRYPTION_KEY;
    if(existing?.trim()){validateSessionEncryptionKey(existing);return {created:false,configured:true,existingKeyPreserved:true};}
    await appendFile(file,(original.endsWith('\n')?'':'\n')+'LEDGERFLOW_SESSION_ENCRYPTION_KEY='+randomBytes(32).toString('base64')+'\n','utf8');
    return {created:true,configured:true,existingKeyPreserved:false};
  }finally{await lock.close();await unlink(lockPath);}
}
