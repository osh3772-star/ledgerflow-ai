import {describe,expect,it} from 'vitest';
import {deploymentReadiness,type LocalDeploymentFacts} from '../../scripts/deployment-readiness.js';
const facts:LocalDeploymentFacts={dockerInstalled:true,dockerDaemonReady:true,githubInstalled:true,githubAuthenticated:true,
  gitHasCommit:true,gitHasRemote:true,dashboardBuilt:true,projectClientsMatch:true};
describe('deployment preparation does not imply external acceptance',()=>{
  it('marks external acceptance unverified even with every dependency present',()=>{
    const report=deploymentReadiness({},facts);
    expect(report.localPreparationPassed).toBe(true);
    expect(report.externalVerificationComplete).toBe(false);
    for(const id of ['docker-image-verification','supabase-live-verification','native-app-acceptance','human-ledger-decision']){
      expect(report.tasks.find(task=>task.id===id)?.status).toBe('unverified');
    }
  });
  it('reports missing user credentials only as presence flags, never values',()=>{
    const report=deploymentReadiness({LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_DATABASE_URL:'postgresql://private-user:private-pass@private-host/db',
      LEDGERFLOW_USER_ID:'private-user-id',LEDGERFLOW_COMPANY_ID:'private-company-id',SUPABASE_URL:'https://private-project.example',SUPABASE_PUBLISHABLE_KEY:'private-key'},facts);
    expect(report.configuration).toMatchObject({databaseConfigured:true,externalAuthConfigured:true});
    expect(JSON.stringify(report)).not.toMatch(/private-user|private-pass|private-host|private-company|private-project|private-key/u);
    expect(report.tasks.find(task=>task.id==='supabase-project')?.status).toBe('ready');
  });
  it('rejects demo/database conflicts and incomplete persistent profiles as local preparation',()=>{
    for(const environment of [{LEDGERFLOW_MCP_MODE:'other'},{LEDGERFLOW_MCP_MODE:'demo',LEDGERFLOW_DATABASE_URL:'fixture'},
      {LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_DATABASE_URL:'fixture'}])expect(deploymentReadiness(environment,facts).localPreparationPassed).toBe(false);
  });
  it('assigns account decisions to the user and implementation to Codex',()=>{
    const report=deploymentReadiness({},{...facts,dockerDaemonReady:false,githubAuthenticated:false,gitHasRemote:false});
    expect(report.tasks.find(task=>task.id==='github-login')).toMatchObject({owner:'user',status:'needed'});
    expect(report.tasks.find(task=>task.id==='docker-engine')).toMatchObject({owner:'user',status:'needed'});
    expect(report.tasks.find(task=>task.id==='remote-security')).toMatchObject({owner:'codex',status:'needed'});
    expect(report.tasks.find(task=>task.id==='human-ledger-decision')?.owner).toBe('user');
    expect(report).toMatchObject({accountingMutations:0,publicApiCalls:0,paidModelApiCalls:0,remoteMcpImplemented:false});
  });
  it('requires external Auth and a valid server key for the selected persistent session mode',()=>{
    expect(deploymentReadiness({LEDGERFLOW_HUMAN_SESSION_STORE:'postgres'},facts).localPreparationPassed).toBe(false);
    expect(deploymentReadiness({LEDGERFLOW_HUMAN_SESSION_STORE:'invalid'},facts).configuration.humanSessionStore).toBe('invalid');
    const report=deploymentReadiness({LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_HUMAN_SESSION_STORE:'postgres',
      LEDGERFLOW_DATABASE_URL:'fixture',LEDGERFLOW_USER_ID:'fixture',LEDGERFLOW_COMPANY_ID:'fixture',
      SUPABASE_URL:'fixture',SUPABASE_PUBLISHABLE_KEY:'fixture',LEDGERFLOW_SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},facts);
    expect(report.configuration).toMatchObject({humanSessionStore:'postgres',sessionConfigReady:true});
    expect(report.localPreparationPassed).toBe(true);expect(report.externalVerificationComplete).toBe(false);
  });
});
