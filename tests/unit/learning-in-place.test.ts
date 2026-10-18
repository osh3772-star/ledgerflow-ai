import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {parse as toml} from 'smol-toml';
import {installInPlace,mergeCodexConfig} from '../../scripts/learning-in-place.js';

describe('in-place guest installer preserves current work and private active configs',()=>{
 let root:string;const base=resolve('.ledgerflow/tmp'),token='lf_guest_'+'a'.repeat(43),companyId='11111111-1111-4111-8111-111111111111';
 const requests:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,body=JSON.parse(String(init?.body));requests.push(path+':'+(body.method??'provision'));
  if(path.endsWith('/guest'))return Response.json({token,companyId,mcpUrl:'https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp',expiresAt:new Date(Date.now()+86400000).toISOString()});
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+token);
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  const result=body.method==='initialize'?{protocolVersion:'2025-11-25'}:body.method==='tools/list'?{tools:Array.from({length:41},()=>({}))}:
   {structuredContent:{ok:true,data:body.params.name==='get_system_status'?{server:'ledgerflow-accounting-mcp'}:{companyId,name:'한빛유통'}}};
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 };
 beforeAll(async()=>{await mkdir(base,{recursive:true});root=await mkdtemp(join(base,'in-place-'));});
 afterAll(async()=>{if(!root.startsWith(base+sep))throw new Error('UNOWNED_TEST_PATH');await rm(root,{recursive:true,force:true});});
 const install=(client:'codex'|'claude'|'antigravity',name:string=client)=>installInPlace({directory:join(root,name),sourceDirectory:process.cwd(),client,homeDirectory:join(root,name+'-home'),fetcher});
 it('merges current folder rules and Codex settings without replacing personal files or exposing a token',async()=>{
  const target=join(root,'codex'),home=join(root,'codex-home');await mkdir(join(target,'.codex'),{recursive:true});await mkdir(join(home,'.codex'),{recursive:true});
  await writeFile(join(target,'AGENTS.md'),'# My instructions\nPreserve this.\n');await writeFile(join(target,'notes.txt'),'私のノート');
  await writeFile(join(home,'.codex/config.toml'),'model = "my-model"\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n');
  await writeFile(join(target,'.codex/config.toml'),'# project\n[mcp_servers.ledgerflow-accounting-mcp]\nurl="http://127.0.0.1:8787/mcp"\n');
  const result=await install('codex');expect(result).toMatchObject({mcpProtocolVerified:true,nativeClientVerified:false,roles:6});
  expect(result.protocol).toMatchObject({get_system_status:true,get_company_context:true,companyName:'한빛유통'});
  expect(await readFile(join(target,'notes.txt'),'utf8')).toBe('私のノート');expect(await readFile(join(target,'AGENTS.md'),'utf8')).toContain('# My instructions');
  const homeBefore='model = \"my-model\"\n[mcp_servers.other]\nurl = \"https://example.test/mcp\"\n';
  expect(await readFile(join(home,'.codex/config.toml'),'utf8')).toBe(homeBefore);
  const settings=await readFile(join(target,'.codex/config.toml'),'utf8'),parsed=toml(settings) as any;
  expect(parsed.mcp_servers['ledgerflow-accounting-mcp'].url).toContain('/mcp/g/'+token);
  expect(parsed.mcp_servers['ledgerflow-accounting-mcp'].http_headers_helper).toBeUndefined();
  const again=await install('codex');expect(again.nativeClientVerified).toBe(false);
  expect((await readFile(join(target,'AGENTS.md'),'utf8')).match(/ledgerflow-learning:start/gu)).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain(token);expect(await readFile(join(target,'.gitignore'),'utf8')).toContain('/.ledgerflow/');
 });
 it('preserves a modified role and contract, and explicitly references the alternate contract',async()=>{
  const target=join(root,'custom');await mkdir(join(target,'.agents/skills/ledgerflow-audit'),{recursive:true});await mkdir(join(target,'docs'),{recursive:true});
  await writeFile(join(target,'.agents/skills/ledgerflow-audit/SKILL.md'),'My custom role');await writeFile(join(target,'docs/CLIENT_ROLES.md'),'My custom contract');
  const r=await install('claude','custom');expect(r.preservedFiles).toContain('.agents/skills/ledgerflow-audit/SKILL.md');
  expect(await readFile(join(target,'docs/CLIENT_ROLES.md'),'utf8')).toBe('My custom contract');
  expect(await readFile(join(target,'AGENTS.md'),'utf8')).toContain('.ledgerflow/CLIENT_ROLES.md');
 });
 it('keeps Claude global settings unchanged and merges only the workspace config',async()=>{
  const home=join(root,'claude-home'),target=join(root,'claude');await mkdir(home,{recursive:true});await mkdir(target,{recursive:true});
  const original=JSON.stringify({theme:'dark',mcpServers:{other:{url:'https://other.test'}}});await writeFile(join(home,'.claude.json'),original);
  await writeFile(join(target,'.mcp.json'),JSON.stringify({mcpServers:{other:{url:'https://other.test'}}}));
  await install('claude');expect(await readFile(join(home,'.claude.json'),'utf8')).toBe(original);
  const c=JSON.parse(await readFile(join(target,'.mcp.json'),'utf8'));
  expect(c.mcpServers.other.url).toBe('https://other.test');expect(c.mcpServers['ledgerflow-accounting-mcp']).toEqual({type:'http',url:'https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp/g/'+token});
 });
 it('registers Antigravity inside its workspace plugin and never creates global configuration',async()=>{
  const r=await install('antigravity');const c=JSON.parse(await readFile(join(root,'antigravity/.agents/plugins/ledgerflow-learning/mcp_config.json'),'utf8'));
  expect(c.mcpServers['ledgerflow-accounting-mcp']).toEqual({serverUrl:'https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp/g/'+token});
  await expect(readFile(join(root,'antigravity-home/.gemini/config/mcp_config.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(root,'antigravity/GEMINI.md'),'utf8')).toContain('현재 docs/MCP_CATALOG.json');
  expect(await readFile(join(root,'antigravity/docs/MCP_CATALOG.json'),'utf8')).toContain('propose_journal_entry');
  expect(JSON.stringify(r)).not.toContain(token);
 });
 it('limits its TOML mutation to the owned server, including old credential subtables',()=>{
  const source='model="x"\n[mcp_servers.ledgerflow-accounting-mcp]\ncommand="old"\n[mcp_servers.ledgerflow-accounting-mcp.http_headers]\nAuthorization="old"\n[features]\nx=true\n[mcp_servers.other]\nurl="keep"\n';
  const result=toml(mergeCodexConfig(source,'[mcp_servers.ledgerflow-accounting-mcp]\nurl="new"')) as any;
  expect(result).toMatchObject({model:'x',features:{x:true},mcp_servers:{other:{url:'keep'},'ledgerflow-accounting-mcp':{url:'new'}}});
  expect(result.mcp_servers['ledgerflow-accounting-mcp'].http_headers).toBeUndefined();
  expect(()=>mergeCodexConfig('instructions="""ambiguous\n"""','')).toThrow('CODEX_CONFIG_MULTILINE_REVIEW_REQUIRED');
 });
 it('does not claim success when provisioning fails or modify an invalid existing client config',async()=>{
  const target=join(root,'failed');
  await expect(installInPlace({directory:target,sourceDirectory:process.cwd(),client:'codex',homeDirectory:join(root,'failed-home'),fetcher:async()=>Response.json({error:'GUEST_CAPACITY_REACHED'},{status:400})})).rejects.toThrow('GUEST_CAPACITY_REACHED');
  const t=join(root,'invalid');await mkdir(t,{recursive:true});await writeFile(join(t,'.mcp.json'),'my existing non-json');
  await expect(install('claude','invalid')).rejects.toThrow();expect(await readFile(join(t,'.mcp.json'),'utf8')).toBe('my existing non-json');
 });
 it('switches a prior guest installation with a claim code, retains the personal session on retry, and never silently provisions a guest',async()=>{
  const target=join(root,'switch');await install('codex','switch');
  const personalToken='lf_personal_'+'b'.repeat(43),paths:string[]=[];
  const personalFetch:typeof fetch=async(input,init)=>{
   const path=new URL(String(input)).pathname,body=JSON.parse(String(init?.body));paths.push(path);
   if(path==='/api/remote/claim'){
    expect(body).toMatchObject({claimCode:'c'.repeat(43),guestToken:token,client:'codex'});
    return Response.json({token:personalToken,companyId,mcpUrl:'https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp',mode:'personal',expiresAt:new Date(Date.now()+604800000).toISOString()});
   }
   expect(path).toContain('/mcp/p/');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+personalToken);
   const headers=new Headers(init?.headers);headers.set('authorization','Bearer '+token);return fetcher(input,{...init,headers});
  };
  const options={directory:target,sourceDirectory:process.cwd(),client:'codex' as const,fetcher:personalFetch};
  const result=await installInPlace({...options,claimCode:'c'.repeat(43)});expect(result.mode).toBe('in_place_personal');
  expect(JSON.stringify(result)).not.toContain(personalToken);expect(await readFile(join(target,'.codex/config.toml'),'utf8')).toContain('/mcp/p/'+personalToken);
  await installInPlace(options);expect(paths.filter(p=>p==='/api/remote/claim')).toHaveLength(1);expect(paths).not.toContain('/api/remote/guest');
  const failed:string[]=[];
  await expect(installInPlace({...options,claimCode:'d'.repeat(43),fetcher:async input=>{failed.push(new URL(String(input)).pathname);return Response.json({error:'CLAIM_CODE_EXPIRED'},{status:400});}})).rejects.toThrow('CLAIM_CODE_EXPIRED');
  expect(failed).toEqual(['/api/remote/claim']);expect(await readFile(join(target,'.codex/config.toml'),'utf8')).toContain(personalToken);
 });
});
