import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
test('administrator MFA enrollment, challenge, verification and enrollment-required management gate', async () => {
  const f = await fixture();
  try {
    const cookies = new Map<string, string>();
    async function auth(path: string, body: any, token?: string) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      };
      if (cookies.size)
        headers.cookie = [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
      const response = await fetch(f.url + '/platform/auth' + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0]!;
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      return { response, value: await response.json() };
    }
    const p = await f.project('mfa');
    const previous = process.env.QB_REQUIRE_ADMIN_MFA;
    process.env.QB_REQUIRE_ADMIN_MFA = 'true';
    try {
      const denied = await f.response(`/management/v1/projects/${p.id}/keys`, 'POST', {}, f.token);
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    } finally {
      previous === undefined
        ? delete process.env.QB_REQUIRE_ADMIN_MFA
        : (process.env.QB_REQUIRE_ADMIN_MFA = previous);
    }
    const enrollment = await auth(
      '/two-factor/enable',
      { password: 'owner-password-12345' },
      f.token,
    );
    expect(enrollment.response.ok).toBe(true);
    expect(enrollment.value.backupCodes.length).toBeGreaterThan(0);
    const secret = new URL(enrollment.value.totpURI).searchParams.get('secret')!;
    let bits = '';
    for (const ch of secret.replace(/=+$/, ''))
      bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
    const raw = String.fromCharCode(
      ...Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
        parseInt(bits.slice(i * 8, i * 8 + 8), 2),
      ),
    );
    const { code } = await (f.service.platform.api as any).generateTOTP({ body: { secret: raw } });
    const verified = await auth('/two-factor/verify-totp', { code }, f.token);
    expect(verified.response.ok).toBe(true);
    await auth('/sign-out', {});
    cookies.clear();
    const challenge = await auth('/sign-in/email', {
      email: 'owner@example.com',
      password: 'owner-password-12345',
    });
    expect(challenge.value.twoFactorRedirect).toBe(true);
    expect(challenge.value.token).toBeUndefined();
    const invalid = await auth('/two-factor/verify-totp', { code: '000000' });
    expect(invalid.response.ok).toBe(false);
    const complete = await auth('/two-factor/verify-totp', { code });
    expect(complete.response.ok).toBe(true);
    expect(complete.value.user.email).toBe('owner@example.com');
    p.client.dispose();
  } finally {
    await f.close();
  }
}, 10000);
