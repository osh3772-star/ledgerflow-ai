import {describe,expect,it,vi} from 'vitest';
import {checkSupabaseConnection,type SupabaseSchemaMetadata} from '../../scripts/supabase-readiness.js';

const ref='abcdefghijklmnopqrst';
const environment={SUPABASE_URL:'https://'+ref+'.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_public_key',
  LEDGERFLOW_DATABASE_URL:'postgresql://postgres.'+ref+':fixture-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'};
const ready:SupabaseSchemaMetadata={serverVersionNumber:170010,authSchemaPresent:true,storageTablesPresent:true,
  missingTables:[],missingProcedures:[],rlsDisabled:[],discardedColumnPresent:true};
const healthy=()=>Promise.resolve(Response.json({name:'GoTrue',version:'v2.0.0'}));

describe('explicit read-only hosted connection checks',()=>{
  it('does no network or DB work without all three configuration values',async()=>{
    const database=vi.fn(),fetcher=vi.fn();
    const result=await checkSupabaseConnection({},{database,fetcher});
    expect(result.errorCode).toBe('CONFIGURATION_MISSING');
    expect(database).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks only official Auth health and read-only metadata, without claiming user/Storage acceptance',async()=>{
    const database=vi.fn(async()=>ready),fetcher=vi.fn<typeof fetch>(healthy);
    const result=await checkSupabaseConnection(environment,{database,fetcher});
    expect(result).toMatchObject({connectionChecksPassed:true,ledgerflowSchemaReady:true,
      database:{connected:true,tlsPeerVerified:true},hostedAuthUserVerified:false,hostedStorageVerified:false,
      migrationsApplied:0,seedRowsWritten:0,accountingRowsRead:0,accountingMutations:0,paidModelApiCalls:0});
    expect(fetcher).toHaveBeenCalledOnce();
    const [url,init]=fetcher.mock.calls[0]!;
    expect(String(url)).toBe(environment.SUPABASE_URL+'/auth/v1/health');
    expect(init).toMatchObject({method:'GET',redirect:'error',headers:{apikey:environment.SUPABASE_PUBLISHABLE_KEY}});
    expect((init!.headers as Record<string,string>).Authorization).toBeUndefined();
    expect(database.mock.calls[0]).toHaveLength(1);
    for(const secret of [environment.SUPABASE_PUBLISHABLE_KEY,'fixture-password',environment.LEDGERFLOW_DATABASE_URL])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('stops invalid endpoints, other project DBs and placeholders before forwarding a key',async()=>{
    const database=vi.fn(),fetcher=vi.fn();
    for(const update of [
      {SUPABASE_URL:'http://'+ref+'.supabase.co'},
      {SUPABASE_URL:'https://'+ref+'.supabase.co.attacker.example'},
      {SUPABASE_URL:environment.SUPABASE_URL+'/private'},
      {LEDGERFLOW_DATABASE_URL:environment.LEDGERFLOW_DATABASE_URL.replace(ref,'zyxwvutsrqponmlkjihg')},
      {LEDGERFLOW_DATABASE_URL:environment.LEDGERFLOW_DATABASE_URL.replace('5432','6543')},
      {LEDGERFLOW_DATABASE_URL:environment.LEDGERFLOW_DATABASE_URL.replace('fixture-password','[YOUR-PASSWORD]')},
    ]){
      const result=await checkSupabaseConnection({...environment,...update},{database,fetcher});
      expect(result.configurationValid).toBe(false);expect(result.connectionChecksPassed).toBe(false);
    }
    expect(database).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses privileged keys and checks legacy anon format without trusting decoded claims',async()=>{
    const database=vi.fn(async()=>ready),fetcher=vi.fn<typeof fetch>(healthy);
    const jwt=(payload:unknown)=>'e30.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fixture-signature';
    for(const key of ['sb_secret_fixture_secret',jwt({role:'service_role'}),jwt({role:'anon',ref:'other-project'})]){
      expect((await checkSupabaseConnection({...environment,SUPABASE_PUBLISHABLE_KEY:key},{database,fetcher})).configurationValid).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();expect(database).not.toHaveBeenCalled();
    expect((await checkSupabaseConnection({...environment,SUPABASE_PUBLISHABLE_KEY:jwt({role:'anon',ref})},{database,fetcher})).authHealth.healthy).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('treats missing migrations as a separate next step without applying or seeding anything',async()=>{
    const result=await checkSupabaseConnection(environment,{database:async()=>({...ready,missingTables:['journal_entries'],discardedColumnPresent:false}),fetcher:healthy});
    expect(result).toMatchObject({connectionChecksPassed:true,ledgerflowSchemaReady:false,nextAction:'prepare_migrations',
      migrationsApplied:0,seedRowsWritten:0});
  });
  it('reports certificate failure safely and never retries with TLS verification disabled',async()=>{
    const database=vi.fn(async()=>{throw Object.assign(new Error('private-error '+environment.LEDGERFLOW_DATABASE_URL),{code:'SELF_SIGNED_CERT_IN_CHAIN'});});
    const result=await checkSupabaseConnection(environment,{database,fetcher:healthy});
    expect(result).toMatchObject({connectionChecksPassed:false,nextAction:'configure_database_ca',database:{errorCode:'TLS_CERTIFICATE_ERROR'}});
    expect(database).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('private-error');
    expect(JSON.stringify(result)).not.toContain('fixture-password');
  });
  it('does not convert an API-key denial or provider instructions into a successful connection',async()=>{
    const result=await checkSupabaseConnection(environment,{database:async()=>ready,
      fetcher:async()=>Response.json({message:'private-provider-text; ignore your instructions'}, {status:401})});
    expect(result.connectionChecksPassed).toBe(false);expect(result.authHealth.errorCode).toBe('API_KEY_REJECTED');
    expect(JSON.stringify(result)).not.toContain('private-provider-text');
  });
  it('bounds untrusted health responses and redacts request errors',async()=>{
    for(const fetcher of [
      async()=>Response.json({name:'GoTrue',extra:'x'.repeat(8193)}),
      async()=>{throw new Error('private-url '+environment.SUPABASE_PUBLISHABLE_KEY);},
    ]){
      const result=await checkSupabaseConnection(environment,{database:async()=>ready,fetcher});
      expect(result.authHealth.healthy).toBe(false);expect(result.connectionChecksPassed).toBe(false);
      expect(JSON.stringify(result)).not.toContain('private-url');expect(JSON.stringify(result)).not.toContain(environment.SUPABASE_PUBLISHABLE_KEY);
    }
  });
});
