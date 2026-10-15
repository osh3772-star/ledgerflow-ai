import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadServerEnvironment } from './server-env.js';
import { PROVIDERS, credentialFingerprint, probePublicApi, type ProbeResult } from './public-api-probe.js';

const keyNames = { nts: 'NTS_SERVICE_KEY', dart: 'DART_API_KEY', law: 'LAW_OC', ecos: 'ECOS_API_KEY' } as const;
try {
  loadServerEnvironment();
  const folder = resolve('.ledgerflow/api-probes');
  mkdirSync(folder, { recursive: true });
  const results: (ProbeResult & { cacheHit: boolean })[] = [];
  for (const provider of PROVIDERS) {
    const key = process.env[keyNames[provider]]?.trim() ?? '';
    const fingerprint = credentialFingerprint(key);
    const file = resolve(folder, provider + '.json');
    let cached: { fingerprint: string; result: ProbeResult } | undefined;
    try { if (existsSync(file)) cached = JSON.parse(readFileSync(file, 'utf8')); } catch { /* invalid cache is not trusted */ }
    if (!process.argv.includes('--refresh') && cached?.fingerprint === fingerprint && cached.result.success
      && Date.now() - Date.parse(cached.result.fetchedAt) < 24 * 60 * 60 * 1000) {
      results.push({ ...cached.result, cacheHit: true });
    } else {
      const result = await probePublicApi(provider, key);
      writeFileSync(file, JSON.stringify({ fingerprint, result }, null, 2) + '\n');
      results.push({ ...result, cacheHit: false });
    }
    const row = results.at(-1)!;
    console.log(provider.toUpperCase() + ': ' + row.code + ', success=' + row.success + ', attempts=' + (row.cacheHit ? 0 : row.attempts) + ', cache=' + row.cacheHit);
  }
  const report = { checkedAt: new Date().toISOString(), successCount: results.filter((row) => row.success).length,
    networkAttempts: results.reduce((sum, row) => sum + (row.cacheHit ? 0 : row.attempts), 0), results };
  writeFileSync(resolve(folder, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Report: .ledgerflow/api-probes/latest.json (credentials and raw responses excluded)');
  if (report.successCount !== 4) process.exitCode = 1;
} catch {
  console.error('공공 API 검증을 완료하지 못했습니다. 환경 설정과 로컬 출력 경로를 확인하세요.');
  process.exitCode = 1;
}
