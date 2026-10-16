import {mkdir,writeFile} from 'node:fs/promises';
import {loadServerEnvironment} from './server-env.js';
import {checkSupabaseConnection} from './supabase-readiness.js';

try{
  loadServerEnvironment();
  const report={generatedAt:new Date().toISOString(),...await checkSupabaseConnection(process.env)};
  await mkdir('.ledgerflow/supabase',{recursive:true});
  await writeFile('.ledgerflow/supabase/latest.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!report.configurationValid)process.exitCode=2;
  else if(!report.connectionChecksPassed)process.exitCode=1;
}catch{
  console.error(JSON.stringify({errorCode:'SUPABASE_CHECK_UNAVAILABLE',credentialsLogged:false}));
  process.exitCode=1;
}
