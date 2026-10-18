import { readFileSync,readdirSync } from 'node:fs';
import {join} from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { selectPublicKeys } from './import-api-keys.js';

try {
  const environment=parseEnv(readFileSync('.env.local','utf8'));
  const keys = selectPublicKeys(environment);
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const buildFiles:string[]=[];
  const visit=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())visit(path);else if(entry.isFile())buildFiles.push(path);}};
  if(process.argv.includes('--web-build'))visit('apps/web/dist');
  const serverSecrets=['LEDGERFLOW_MCP_TOKEN','LEDGERFLOW_SESSION_ENCRYPTION_KEY','LEDGERFLOW_REMOTE_ENCRYPTION_KEY','LEDGERFLOW_DATABASE_URL','SUPABASE_PUBLISHABLE_KEY','LEDGERFLOW_PUBLIC_GATEWAY_TOKEN']
    .map(name=>environment[name]?.trim()).filter((value):value is string=>Boolean(value));
  try{const guest=JSON.parse(readFileSync('.ledgerflow/guest-session.json','utf8'));for(const value of [guest.token,guest.bootstrapKey])if(typeof value==='string'&&value.length>=32)serverSecrets.push(value);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const variants = [...Object.values(keys),...serverSecrets].flatMap((key) => {
    try { return [key, encodeURIComponent(key), decodeURIComponent(key)]; } catch { return [key]; }
  });
  const matches: string[] = [];
  for (const file of [...names,...buildFiles]) {
    const content = readFileSync(file, 'utf8');
    if (variants.some((key) => content.includes(key))) matches.push(file);
  }
  // Report only the affected paths. Do not print values or matching lines.
  console.log(JSON.stringify({ gitVisibleFilesScanned: names.length,publicBuildFilesScanned:buildFiles.length, exposedKeyFileCount: matches.length, files: matches }));
  if (matches.length) process.exitCode = 1;
} catch {
  console.error('키 노출 검사를 완료하지 못했습니다. dotenv 설정과 Git 작업 폴더를 확인하세요.');
  process.exitCode = 1;
}
