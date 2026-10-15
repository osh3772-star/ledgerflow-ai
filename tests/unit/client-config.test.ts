import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { TOOL_NAMES, SERVER_NAME } from '../../apps/mcp-server/src/server.js';
import { createMcpRuntime } from '../../scripts/mcp-runtime.js';

const roles=['supervisor','sales','purchase','treasury','closing','audit'];
describe('native client configuration without a private agent runtime',()=>{
  it('both clients reference exactly one identical HTTP server and no process/key config',async()=>{
    const codex=parseToml(await readFile('.codex/config.toml','utf8')) as {mcp_servers:Record<string,{url:string;enabled_tools:string[]}>};
    const claude=JSON.parse(await readFile('.mcp.json','utf8')) as {mcpServers:Record<string,{type:string;url:string}>};
    expect(Object.keys(codex.mcp_servers)).toEqual([SERVER_NAME]);
    expect(Object.keys(claude.mcpServers)).toEqual([SERVER_NAME]);
    expect(codex.mcp_servers[SERVER_NAME]!.url).toBe(claude.mcpServers[SERVER_NAME]!.url);
    expect(claude.mcpServers[SERVER_NAME]).toEqual({type:'http',url:'http://127.0.0.1:8787/mcp'});
    expect(codex.mcp_servers[SERVER_NAME]!.enabled_tools).toEqual([...TOOL_NAMES]);
  });
  it('defines all six native roles, synchronized valid skills, and only known read tools',async()=>{
    for(const role of roles){
      const name='ledgerflow-'+role;
      const codex=parseToml(await readFile('.codex/agents/'+name+'.toml','utf8')) as Record<string,unknown>;
      expect(codex.name).toBe(name);expect(codex.developer_instructions).toBeTypeOf('string');
      expect(codex.features).toMatchObject({shell_tool:false,apps:false,plugins:false});
      expect(codex).not.toHaveProperty('model');expect(codex).not.toHaveProperty('mcp_servers');
      const agent=await readFile('.claude/agents/'+name+'.md','utf8');
      const frontmatter=parseYaml(agent.match(/^---\n([\s\S]*?)\n---/u)![1]!) as {name:string;tools:string;skills:string[]};
      expect(frontmatter.name).toBe(name);expect(frontmatter.skills).toEqual([name]);
      const tools=frontmatter.tools.split(',').map((tool)=>tool.trim());
      expect(tools.filter((tool)=>['Bash','Edit','Write'].includes(tool))).toEqual([]);
      for(const tool of tools.filter((tool)=>tool.startsWith('mcp__')))
        expect(TOOL_NAMES).toContain(tool.replace('mcp__'+SERVER_NAME+'__',''));
      const skill=await readFile('.agents/skills/'+name+'/SKILL.md','utf8');
      expect(skill).toBe(await readFile('.claude/skills/'+name+'/SKILL.md','utf8'));
      expect(parseYaml(skill.match(/^---\n([\s\S]*?)\n---/u)![1]!)).toMatchObject({name,description:expect.any(String)});
    }
  });
  it('fails before provisioning on conflicting or incomplete database profiles',async()=>{
    await expect(createMcpRuntime({LEDGERFLOW_MCP_MODE:'other'})).rejects.toThrow('demo or postgres');
    await expect(createMcpRuntime({LEDGERFLOW_MCP_MODE:'postgres'})).rejects.toThrow('server-side database URL');
    await expect(createMcpRuntime({LEDGERFLOW_MCP_MODE:'demo',LEDGERFLOW_DATABASE_URL:'private-fixture-url'})).rejects.toThrow('Select postgres');
    await expect(createMcpRuntime({LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_DATABASE_URL:'private-fixture-url',
      LEDGERFLOW_COMPANY_ID:'not-a-valid-secret-id'})).rejects.toThrow('valid server-side');
  });
  it('requires explicit external Auth and a valid key before persistent-session initialization',async()=>{
    await expect(createMcpRuntime({LEDGERFLOW_HUMAN_SESSION_STORE:'invalid'})).rejects.toThrow('memory or postgres');
    await expect(createMcpRuntime({LEDGERFLOW_HUMAN_SESSION_STORE:'postgres'})).rejects.toThrow('require postgres mode');
    await expect(createMcpRuntime({LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_HUMAN_SESSION_STORE:'postgres',
      SUPABASE_URL:'https://auth.fixture.example',SUPABASE_PUBLISHABLE_KEY:'fixture-key',LEDGERFLOW_SESSION_ENCRYPTION_KEY:'private-invalid-fixture'})).rejects.toThrow('canonical base64');
  });
});
