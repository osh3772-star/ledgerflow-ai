import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadServerEnvironment} from './server-env.js';
try{
  execFileSync('git',['check-ignore','--quiet','--','.env.local'],{stdio:'pipe',windowsHide:true});
  loadServerEnvironment();
  const names=['NTS_SERVICE_KEY','DART_API_KEY','LAW_OC','ECOS_API_KEY'];
  if(names.some(name=>!process.env[name]?.trim()))throw new Error('MISSING_KEYS');
  const file='.env.local',original=await readFile(file,'utf8');
  const pattern=/^(?:export[ \t]+)?ADAPTER_MODE[ \t]*=[^\r\n]*/gmu;
  const updated=pattern.test(original)?original.replace(pattern,'ADAPTER_MODE=live'):original+(original.endsWith('\n')?'':'\n')+'ADAPTER_MODE=live\n';
  await writeFile(file,updated,'utf8');
  console.log(JSON.stringify({mode:'live',providerKeysConfigured:4,otherSettingsPreserved:true,restartRequired:true,keysPrinted:false}));
}catch{console.error('Live activation failed. Check the ignored .env.local and four server-side keys. No values are logged.');process.exitCode=1;}
