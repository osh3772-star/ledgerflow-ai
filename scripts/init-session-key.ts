import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {initializeSessionKey} from './session-key.js';
try{
  execFileSync('git',['check-ignore','--quiet','--','.env.local'],{stdio:'pipe',windowsHide:true});
  console.log(JSON.stringify(await initializeSessionKey(resolve('.env.local'))));
}catch{
  console.error('Session key preparation failed. Use an ignored .env.local file and check its existing key or lock. No values are logged.');
  process.exitCode=1;
}
