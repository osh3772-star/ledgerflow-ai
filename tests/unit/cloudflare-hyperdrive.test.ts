import {describe,expect,it} from 'vitest';
import {hyperdriveConfiguration} from '../../scripts/cloudflare-hyperdrive.js';
import {remoteConfigured} from '../../apps/public-api-gateway/src/remote-worker.js';
const project='abcdefghijklmnopqrst';
const environment={SUPABASE_URL:'https://'+project+'.supabase.co',
 LEDGERFLOW_DATABASE_URL:'postgresql://postgres.'+project+':fixture%21%40%23@aws-0-region.pooler.supabase.com:5432/postgres'};
describe('Cloudflare origin TLS and tenant-fresh accounting reads',()=>{
 it('uses a direct Supabase origin, decodes the password once and disables SQL caching',()=>{
  const config=hyperdriveConfiguration(environment,'certificate-fixture');
  expect(config).toMatchObject({origin:{host:'db.'+project+'.supabase.co',user:'postgres',password:'fixture!@#',port:5432},
   caching:{disabled:true},mtls:{ca_certificate_id:'certificate-fixture',sslmode:'verify-full'},origin_connection_limit:5});
  expect(hyperdriveConfiguration({...environment,LEDGERFLOW_DATABASE_URL:'postgres://postgres:fixture@db.'+project+'.supabase.co:5432/postgres'},'cert').origin.user).toBe('postgres');
 });
 it('refuses a different project or unsupported port without echoing credentials',()=>{
  for(const url of ['postgres://postgres:private-marker@another.example:5432/postgres',environment.LEDGERFLOW_DATABASE_URL.replace(':5432',':6543')]){
   expect(()=>hyperdriveConfiguration({...environment,LEDGERFLOW_DATABASE_URL:url},'cert')).toThrow('HYPERDRIVE_ORIGIN_INVALID');
  }
 });
 it('requires the platform binding and never considers a raw DB URL sufficient',()=>{
  const base={REMOTE_ENABLED:'true',REMOTE_ORIGIN:'https://example.com',SUPABASE_URL:environment.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'fixture-key',LEDGERFLOW_REMOTE_ENCRYPTION_KEY:'fixture-key'};
  expect(remoteConfigured(base)).toBe(false);
  expect(remoteConfigured({...base,HYPERDRIVE:{connectionString:'platform-owned-connection'}})).toBe(true);
  expect(remoteConfigured({...base,REMOTE_ENABLED:'false',HYPERDRIVE:{connectionString:'platform-owned-connection'}})).toBe(false);
 });
});
