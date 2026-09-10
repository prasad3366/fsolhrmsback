import { buildCorsOptions, defaultAllowedOrigins } from './cors-options';

describe('buildCorsOptions', () => {
  it('allows localhost and 127.0.0.1 frontend origins for Vite/dev access', async () => {
    const options = buildCorsOptions();

    const allow = (origin: string) =>
      new Promise<boolean>((resolve) => {
        options.origin!(origin, (err, allowed) => {
          if (err) return resolve(false);
          resolve(Boolean(allowed));
        });
      });

    await expect(allow('http://localhost:5173')).resolves.toBe(true);
    await expect(allow('http://127.0.0.1:5173')).resolves.toBe(true);
    expect(defaultAllowedOrigins).toContain('http://localhost:5173');
    expect(defaultAllowedOrigins).toContain('http://127.0.0.1:5173');
  });

  it('rejects unexpected origins', async () => {
    const options = buildCorsOptions();

    const isAllowed = await new Promise<boolean>((resolve) => {
      options.origin!('https://malicious.example', (err, allowed) => {
        if (err) return resolve(false);
        resolve(Boolean(allowed));
      });
    });

    expect(isAllowed).toBe(false);
  });
});
