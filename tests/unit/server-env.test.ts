import { describe, expect, it } from 'vitest';
import { environmentMetadata } from '../../scripts/server-env.js';

describe('server secret metadata', () => {
  it('reports presence without returning any key value', () => {
    const marker = 'fixture-value-not-a-real-api-key';
    const output = environmentMetadata({ NTS_SERVICE_KEY: marker, DART_API_KEY: marker });
    expect(output.keys.find((row) => row.name === 'NTS_SERVICE_KEY')?.configured).toBe(true);
    expect(JSON.stringify(output)).not.toContain(marker);
  });
  it('treats empty/whitespace-only values as unset', () => {
    const output = environmentMetadata({ NTS_SERVICE_KEY: '', DART_API_KEY: '  ' });
    expect(output.keys.every((row) => !row.configured)).toBe(true);
    expect(output.mode).toBe('mock');
  });
  it('does not enumerate unrelated environment variables', () => {
    const output = environmentMetadata({ UNRELATED_SECRET: 'private-fixture-value' });
    expect(JSON.stringify(output)).not.toContain('UNRELATED_SECRET');
    expect(JSON.stringify(output)).not.toContain('private-fixture-value');
  });
  it('does not echo an invalid mode as an error', () => {
    expect(() => environmentMetadata({ ADAPTER_MODE: 'private-mode-value' }))
      .toThrow('ADAPTER_MODE must be mock or live.');
  });
});
