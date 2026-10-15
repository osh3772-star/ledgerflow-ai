import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

export const SERVER_KEYS = [
  'NTS_SERVICE_KEY', 'DART_API_KEY', 'LAW_OC', 'ECOS_API_KEY',
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY',
  'LEDGERFLOW_DATABASE_URL', 'LEDGERFLOW_USER_ID', 'LEDGERFLOW_COMPANY_ID', 'LEDGERFLOW_MCP_PORT', 'LEDGERFLOW_MCP_MODE',
  'LEDGERFLOW_MCP_TOKEN',
  'LEDGERFLOW_HUMAN_SESSION_STORE','LEDGERFLOW_SESSION_ENCRYPTION_KEY',
] as const;

export function environmentMetadata(environment: NodeJS.ProcessEnv) {
  const mode = environment.ADAPTER_MODE ?? 'mock';
  if (mode !== 'mock' && mode !== 'live') throw new Error('ADAPTER_MODE must be mock or live.');
  return { mode, keys: SERVER_KEYS.map((name) => ({ name, configured: Boolean(environment[name]?.trim()) })) };
}

export function loadServerEnvironment() {
  const file = resolve('.env.local');
  if (existsSync(file)) loadEnvFile(file);
  // Deliberately report presence only. Do not stringify process.env or validation inputs.
  return { file, ...environmentMetadata(process.env) };
}
