import { loadServerEnvironment } from './server-env.js';

try {
  const config = loadServerEnvironment();
  console.log('키 입력 파일: ' + config.file);
  console.log('ADAPTER_MODE: ' + config.mode);
  for (const key of config.keys) console.log(key.name + ': ' + (key.configured ? '설정됨' : '미설정'));
  console.log('키 값은 출력하지 않습니다. 실제 연결 검증: pnpm api:check (명시적 live 조회).');
} catch {
  console.error('환경 설정을 읽지 못했습니다. .env.local 형식과 ADAPTER_MODE를 확인하세요.');
  process.exitCode = 1;
}
