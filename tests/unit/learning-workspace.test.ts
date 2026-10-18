import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parse as parseToml} from 'smol-toml';
import {createLearningWorkspace} from '../../scripts/create-learning-workspace.js';

const execute=promisify(execFile),base=resolve('.ledgerflow/tmp');
describe('secret-free, single-server learning setup',()=>{
 let folder:string;
 beforeAll(async()=>{await mkdir(base,{recursive:true});folder=await mkdtemp(join(base,'learning-'));});
 afterAll(async()=>{if(!folder.startsWith(base+sep))throw new Error('UNOWNED_TEST_PATH');await rm(folder,{recursive:true,force:true});});
 it('prepares both clients and the existing six roles without changing the source settings',async()=>{
  const sourceSettings=await readFile('.codex/config.toml','utf8'),target=join(folder,'first');
  const report=await createLearningWorkspace({directory:target});
  expect(report).toMatchObject({status:'prepared',roles:6,files:30,connectionVerified:false});
  const claude=JSON.parse(await readFile(join(target,'.mcp.json'),'utf8'));
  const codex=parseToml(await readFile(join(target,'.codex/config.toml'),'utf8')) as {mcp_servers:Record<string,{url:string;enabled_tools:string[]}>};
  expect(Object.keys(claude.mcpServers)).toEqual(['ledgerflow-accounting-mcp']);
  expect(Object.keys(codex.mcp_servers)).toEqual(['ledgerflow-accounting-mcp']);
  expect(codex.mcp_servers['ledgerflow-accounting-mcp']!.url).toBe(claude.mcpServers['ledgerflow-accounting-mcp'].url);
  expect(codex.mcp_servers['ledgerflow-accounting-mcp']!.url).toBe('https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp');
  expect(codex.mcp_servers['ledgerflow-accounting-mcp']!.enabled_tools).toHaveLength(41);
  for(const role of ['supervisor','sales','purchase','treasury','closing','audit']){
   for(const path of [`.agents/skills/ledgerflow-${role}/SKILL.md`,`.claude/skills/ledgerflow-${role}/SKILL.md`,
    `.claude/agents/ledgerflow-${role}.md`,`.codex/agents/ledgerflow-${role}.toml`])
    expect(await readFile(join(target,path),'utf8')).toBe(await readFile(path,'utf8'));
  }
  const manifest=JSON.parse(await readFile(join(target,'.hanbit-study.json'),'utf8'));
  expect(Object.keys(manifest.files).some(path=>/\.env|auth\.json|credentials/u.test(path))).toBe(false);
  expect(await readFile('.codex/config.toml','utf8')).toBe(sourceSettings);
 });
 it('reuses a matching prepared folder and preserves additional learner files',async()=>{
  const target=join(folder,'repeat');await createLearningWorkspace({directory:target});
  await writeFile(join(target,'my-notes.txt'),'내가 공부한 분개');
  expect(await createLearningWorkspace({directory:target})).toMatchObject({status:'already_prepared',connectionVerified:false});
  expect(await readFile(join(target,'my-notes.txt'),'utf8')).toBe('내가 공부한 분개');
 });
 it('never overwrites an existing project or a source checkout',async()=>{
  const target=join(folder,'existing');await mkdir(target);
  await writeFile(join(target,'.mcp.json'),'existing-project-settings');
  await expect(createLearningWorkspace({directory:target})).rejects.toThrow('LEARNING_FOLDER_CONFLICT');
  expect(await readFile(join(target,'.mcp.json'),'utf8')).toBe('existing-project-settings');
  await expect(createLearningWorkspace({directory:process.cwd()})).rejects.toThrow('USE_SEPARATE_LEARNING_FOLDER');
 });
 it('rejects changed managed settings instead of replacing them or claiming success',async()=>{
  const target=join(folder,'changed');await createLearningWorkspace({directory:target});
  await writeFile(join(target,'.codex/config.toml'),'my-changed-settings');
  await expect(createLearningWorkspace({directory:target})).rejects.toThrow('LEARNING_FOLDER_MODIFIED');
  expect(await readFile(join(target,'.codex/config.toml'),'utf8')).toBe('my-changed-settings');
 });
 it('runs with plain Node and no pnpm installation, authentication or MCP success claim',async()=>{
  const {stdout,stderr}=await execute(process.execPath,['scripts/create-learning-workspace.ts','--directory',join(folder,'plain-node')],{cwd:process.cwd(),windowsHide:true});
  expect(stderr).toBe('');expect(JSON.parse(stdout)).toMatchObject({status:'prepared',roles:6,connectionVerified:false});
 });
});
