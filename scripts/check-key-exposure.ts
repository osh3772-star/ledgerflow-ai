import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { selectPublicKeys } from './import-api-keys.js';

try {
  const environment=parseEnv(readFileSync('.env.local','utf8'));
  const keys = selectPublicKeys(environment);
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const serverSecrets=['LEDGERFLOW_MCP_TOKEN','LEDGERFLOW_SESSION_ENCRYPTION_KEY','LEDGERFLOW_DATABASE_URL']
    .map(name=>environment[name]?.trim()).filter((value):value is string=>Boolean(value));
  const variants = [...Object.values(keys),...serverSecrets].flatMap((key) => {
    try { return [key, encodeURIComponent(key), decodeURIComponent(key)]; } catch { return [key]; }
  });
  const matches: string[] = [];
  for (const file of names) {
    const content = readFileSync(file, 'utf8');
    if (variants.some((key) => content.includes(key))) matches.push(file);
  }
  // Report only the affected paths. Do not print values or matching lines.
  console.log(JSON.stringify({ gitVisibleFilesScanned: names.length, exposedKeyFileCount: matches.length, files: matches }));
  if (matches.length) process.exitCode = 1;
} catch {
  console.error('키 노출 검사를 완료하지 못했습니다. dotenv 설정과 Git 작업 폴더를 확인하세요.');
  process.exitCode = 1;
}
