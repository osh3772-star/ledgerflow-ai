import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadServerEnvironment} from './server-env.js';
import {inspectProjectClients,localMcpEndpoint} from './connection-check.js';
import {deploymentReadiness} from './deployment-readiness.js';
loadServerEnvironment();
const run=promisify(execFile);
// Commands are fixed metadata reads. Never print native stdout/stderr or env.
async function succeeds(command:string,args:string[],nonempty=false){
  try{
    const result=await run(command,args,{windowsHide:true,timeout:10000,maxBuffer:262144});
    return !nonempty||Boolean(result.stdout.trim());
  }catch{return false;}
}
let built=false,clientsMatch=false;
try{built=(await stat('apps/web/dist/index.html')).isFile();}catch{/* Build is a subsequent task. */}
try{
  const endpoint=localMcpEndpoint(process.env.LEDGERFLOW_MCP_URL??'http://127.0.0.1:'+(process.env.LEDGERFLOW_MCP_PORT??'8787')+'/mcp');
  const clients=await inspectProjectClients(process.cwd(),endpoint.href);
  clientsMatch=Object.values(clients).every(row=>row.configured&&row.endpointMatches&&row.catalogMatches!==false);
}catch{/* Report only a boolean mismatch, never a raw malformed URL. */}
const [dockerInstalled,githubInstalled,gitHasCommit,gitHasRemote]=await Promise.all([
  succeeds('docker',['--version']),succeeds('gh',['--version']),
  succeeds('git',['rev-parse','--verify','HEAD']),succeeds('git',['remote'],true),
]);
const [dockerDaemonReady,githubAuthenticated]=await Promise.all([
  dockerInstalled?succeeds('docker',['info','--format','{{.ServerVersion}}']):Promise.resolve(false),
  githubInstalled?succeeds('gh',['auth','status']):Promise.resolve(false),
]);
const report={generatedAt:new Date().toISOString(),...deploymentReadiness(process.env,{dockerInstalled,dockerDaemonReady,
  githubInstalled,githubAuthenticated,gitHasCommit,gitHasRemote,dashboardBuilt:built,projectClientsMatch:clientsMatch})};
await mkdir(resolve('.ledgerflow/deployment'),{recursive:true});
await writeFile(resolve('.ledgerflow/deployment/latest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.localPreparationPassed)process.exitCode=1;
