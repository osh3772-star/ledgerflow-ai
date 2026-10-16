import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {GatewayPublicDataClient} from '@ledgerflow/public-data';
import {DomainError} from '@ledgerflow/contracts';
import {loadServerEnvironment} from './server-env.js';

async function privateToken():Promise<string>{
  if(!process.stdin.isTTY)throw new Error('INTERACTIVE_TOKEN_REQUIRED');
  process.stdout.write('운영자에게 받은 접속 토큰 입력 (화면에 표시되지 않습니다): ');
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error?:Error)=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const onData=(chunk:string)=>{for(const char of chunk){
      if(char==='\u0003'){finish(new Error('CANCELLED'));return;}
      if(char==='\r'||char==='\n'){finish();return;}
      if(char==='\u007f'||char==='\b')value=value.slice(0,-1);
      else if(char>=' '&&value.length<1025)value+=char;
    }};process.stdin.on('data',onData);
  });
}
try{
  execFileSync('git',['check-ignore','--quiet','.env.local'],{stdio:'ignore'});loadServerEnvironment();
  const published=JSON.parse(readFileSync('config/public-gateway.json','utf8')) as {url:string|null};
  const url=process.argv[2]??published.url;if(!url)throw new Error('GATEWAY_NOT_PUBLISHED');
  const token=(process.env.LEDGERFLOW_PUBLIC_GATEWAY_TOKEN||await privateToken()).trim();
  const client=new GatewayPublicDataClient(url,token),now=new Date(),today=now.toISOString().slice(0,10);
  // A monthly series may not publish the current month until later.
  const from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-3,1)).toISOString().slice(0,10);
  await client.call('get_interest_rate',{from,to:today});
  let content=existsSync('.env.local')?readFileSync('.env.local','utf8'):'';
  for(const [name,value] of Object.entries({LEDGERFLOW_PUBLIC_GATEWAY_URL:url,LEDGERFLOW_PUBLIC_GATEWAY_TOKEN:token})){
    const pattern=new RegExp('^'+name+'=.*$','gmu'),line=name+'='+JSON.stringify(value);
    content=pattern.test(content)?content.replace(pattern,line):content+'\n'+line+'\n';
  }
  writeFileSync('.env.local',content);
  console.log(JSON.stringify({connected:true,mode:'gateway',origin:'public_api_live',restartRequired:true,ownerProviderKeysRequired:false,tokenPrinted:false}));
}catch(error){console.error(JSON.stringify({connected:false,code:error instanceof DomainError?error.code:'GATEWAY_SETUP_FAILED',settingsPreserved:true,secretsPrinted:false}));process.exitCode=1;}
