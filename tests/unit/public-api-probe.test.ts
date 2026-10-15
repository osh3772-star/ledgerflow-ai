import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from 'node:util';
import { mergePublicKeys, selectPublicKeys } from '../../scripts/import-api-keys.js';
import { probePublicApi } from '../../scripts/public-api-probe.js';

const testKey = 'fixture-secret-never-a-live-key';
const fakeResponse = (json: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(json), { status, headers });
describe('safe public API probes', () => {
  it('accepts either portal key representation and does not include credentials in results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ status_code: 'OK', data: [{ b_no: '0000000000', tax_type: 'unregistered fixture' }] }));
    const result = await probePublicApi('nts', 'fixture%2Bkey%2F%3D', { fetchImpl });
    const request = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(request.searchParams.get('serviceKey')).toBe('fixture+key/=');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ b_no: ['0000000000'] });
    expect(result).toMatchObject({ success: true, origin: 'public_api_live', summary: { registeredTestBusiness: false } });
    expect(JSON.stringify(result)).not.toContain('fixture%2B');
    expect(JSON.stringify(result)).not.toContain('fixture+key');
  });
  it('records DART auth rejection without retrying or returning the provider message', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ status: '010', message: testKey }));
    const result = await probePublicApi('dart', testKey, { fetchImpl });
    expect(result).toMatchObject({ success: false, code: 'DART_010', attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(testKey);
  });
  it('does not mistake DART no-data or unrelated company results for a verified query', async () => {
    expect((await probePublicApi('dart', testKey, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ status: '013' })) })).success).toBe(false);
    expect((await probePublicApi('dart', testKey, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ status: '000', list: [{ corp_code: 'wrong', rcept_no: '123' }] })) })).code).toBe('SCHEMA_MISMATCH');
  });
  it('checks law result code and effective date without echoing external text', async () => {
    const result = await probePublicApi('law', testKey, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ LawSearch: {
      resultCode: '00', totalCnt: '1', law: { '법령명한글': testKey, '시행일자': '20260101' },
    } })) });
    expect(result).toMatchObject({ success: true, summary: { effectiveDate: '20260101' } });
    expect(JSON.stringify(result)).not.toContain(testKey);
  });
  it('rejects ECOS authentication error and malformed observations', async () => {
    const failure = await probePublicApi('ecos', testKey, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ RESULT: { CODE: 'INFO-100', MESSAGE: testKey } })) });
    expect(failure).toMatchObject({ success: false, code: 'ECOS_INFO-100' });
    expect(JSON.stringify(failure)).not.toContain(testKey);
    const malformed = await probePublicApi('ecos', testKey, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ StatisticSearch: { row: [{ STAT_CODE: '200Y101', TIME: '2020', DATA_VALUE: 'execute me' }] } })) });
    expect(malformed.code).toBe('SCHEMA_MISMATCH');
  });
  it('retries transient HTTP errors once, but defers long quota delays', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(fakeResponse({}, 503)).mockResolvedValueOnce(fakeResponse({ status: '000', total_count: 1, list: [{ corp_code: '00126380', rcept_no: '123' }] }));
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    expect(await probePublicApi('dart', testKey, { fetchImpl, wait })).toMatchObject({ success: true, attempts: 2 });
    expect(wait).toHaveBeenCalledTimes(1);
    const quota = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({}, 429, { 'retry-after': '3600' }));
    expect(await probePublicApi('dart', testKey, { fetchImpl: quota, wait })).toMatchObject({ success: false, code: 'HTTP_429', attempts: 1 });
    expect(quota).toHaveBeenCalledTimes(1);
  });
  it('bounds network retries and redacts exception URLs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('https://provider.invalid/?key=' + testKey));
    const result = await probePublicApi('ecos', testKey, { fetchImpl, maxAttempts: 50, wait: async () => {} });
    expect(result).toMatchObject({ success: false, attempts: 2, code: 'NETWORK_OR_TIMEOUT' });
    expect(JSON.stringify(result)).not.toContain(testKey);
  });
  it('records non-JSON responses and blocks redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>denied</html>', { status: 200 }));
    expect((await probePublicApi('law', testKey, { fetchImpl })).code).toBe('NON_JSON_RESPONSE');
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error');
  });
});

describe('public credential import', () => {
  const supplied = { NTS_API_KEY: testKey, DART_API_KEY: testKey, LAW_OC: testKey, ECOS_API_KEY: testKey };
  it('maps NTS alias and imports only four approved variables, preserving local options', () => {
    const merged = mergePublicKeys('ADAPTER_MODE=mock\nSUPABASE_URL=https://fixture.invalid\nDART_API_KEY=old\n', { ...supplied, MALICIOUS_SETTING: testKey });
    expect(parseEnv(merged)).toMatchObject({ ADAPTER_MODE: 'mock', SUPABASE_URL: 'https://fixture.invalid', NTS_SERVICE_KEY: testKey });
    expect(parseEnv(merged).NTS_API_KEY).toBeUndefined();
    expect(parseEnv(merged).MALICIOUS_SETTING).toBeUndefined();
    expect(merged.match(/DART_API_KEY=/gu)).toHaveLength(1);
  });
  it('rejects incomplete credentials and dotenv line injection without reflecting values', () => {
    expect(() => selectPublicKeys({})).toThrow('Invalid or missing public API credential.');
    expect(() => selectPublicKeys({ ...supplied, LAW_OC: testKey + '\nDANGER=1' })).toThrow('Invalid or missing public API credential.');
  });
});
