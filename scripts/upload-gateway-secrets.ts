import {randomBytes} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {loadServerEnvironment} from './server-env.js';

// Owner-only deployment utility. Keys travel over stdin to Wrangler, never argv,
// a checked-in file, browser storage or command output.
try{
  execFileSync('git',['check-ignore','--quiet','.env.local'],{stdio:'ignore'});
  loadServerEnvironment();
  const names=['NTS_SERVICE_KEY','DART_API_KEY','LAW_OC','ECOS_API_KEY'] as const;
  if(names.some(name=>!process.env[name]?.trim()))throw new Error('PROVIDER_KEYS_REQUIRED');
  let token=process.env.LEDGERFLOW_PUBLIC_GATEWAY_TOKEN?.trim();
  if(!token){
    token=randomBytes(32).toString('base64url');
    const file=resolve('.env.local'),current=readFileSync(file,'utf8'),line='LEDGERFLOW_PUBLIC_GATEWAY_TOKEN='+token;
    writeFileSync(file,/^LEDGERFLOW_PUBLIC_GATEWAY_TOKEN=.*$/mu.test(current)?current.replace(/^LEDGERFLOW_PUBLIC_GATEWAY_TOKEN=.*$/gmu,line):current+'\n'+line+'\n');
  }
  if(token.length<32||token.length>1024||/[\r\n]/u.test(token))throw new Error('TOKEN_INVALID');
  const payload={...Object.fromEntries(names.map(name=>[name,process.env[name]!])),GATEWAY_ACCESS_TOKEN:token};
  const require=createRequire(resolve('apps/public-api-gateway/package.json'));
  const wrangler=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
  const child=spawn(process.execPath,[wrangler,'secret','bulk'],{cwd:resolve('apps/public-api-gateway'),stdio:['pipe','pipe','pipe'],windowsHide:true});
  // Suppress CLI output as a defense against accidental environment/error echo.
  child.stdout.resume();child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
  const code=await new Promise<number>((done,reject)=>{child.once('error',reject);child.once('close',value=>done(value??1));});
  if(code!==0)throw new Error('SECRET_UPLOAD_FAILED');
  console.log(JSON.stringify({uploaded:true,providerSecrets:4,accessTokenStoredInIgnoredEnvironment:true,keysPrinted:false}));
}catch{console.error('중계 서버 비밀값 등록을 완료하지 못했습니다. Cloudflare 로그인과 Worker 배포 상태를 확인하세요. 값은 출력하지 않았습니다.');process.exitCode=1;}
