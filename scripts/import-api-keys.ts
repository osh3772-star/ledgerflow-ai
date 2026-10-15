import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const PUBLIC_API_KEYS = ['NTS_SERVICE_KEY', 'DART_API_KEY', 'LAW_OC', 'ECOS_API_KEY'] as const;

export function selectPublicKeys(input: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of PUBLIC_API_KEYS) {
    const value = (input[name] ?? (name === 'NTS_SERVICE_KEY' ? input.NTS_API_KEY : undefined))?.trim();
    if (!value || /[\s"'\\#]/u.test(value)) throw new Error('Invalid or missing public API credential.');
    result[name] = value;
  }
  return result;
}

export function mergePublicKeys(current: string, input: Record<string, string | undefined>): string {
  const selected = selectPublicKeys(input);
  const lines = current.split(/\r?\n/u).filter((line) =>
    !/^\s*(?:export\s+)?(?:NTS_SERVICE_KEY|NTS_API_KEY|DART_API_KEY|LAW_OC|ECOS_API_KEY)\s*=/u.test(line));
  return lines.join('\n').trimEnd() + '\n' + PUBLIC_API_KEYS.map((name) => name + '=' + selected[name]).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/import-api-keys.ts')) {
  try {
    const source = process.argv[2];
    if (!source) throw new Error('Missing source.');
    const target = resolve('.env.local');
    const current = existsSync(target) ? readFileSync(target, 'utf8') : 'ADAPTER_MODE=mock\n';
    const next = mergePublicKeys(current, parseEnv(readFileSync(resolve(source), 'utf8')));
    // Both target and atomic temporary file are excluded by .gitignore.
    writeFileSync(target + '.tmp', next, { encoding: 'utf8', mode: 0o600 });
    renameSync(target + '.tmp', target);
    console.log('Public API credentials imported: ' + PUBLIC_API_KEYS.join(', '));
  } catch {
    console.error('키 파일을 반영하지 못했습니다. 필수 변수와 dotenv 형식을 확인하세요.');
    process.exitCode = 1;
  }
}
