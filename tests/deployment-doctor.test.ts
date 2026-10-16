import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { doctor } from '../.claude/skills/qbflex-skills/scripts/diagnose.mjs';

test('doctor is redacted, readonly, reports unknown capabilities and returns actionable status', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-doctor-'));
  try {
    const sentinel = 'secret-canary-must-never-appear';
    writeFileSync(join(directory, '.env'), `QB_MASTER_KEY=${sentinel}`);
    writeFileSync(
      join(directory, 'qb.json'),
      JSON.stringify({ url: `https://user:${sentinel}@example.com`, token: sentinel }),
    );
    const before = readdirSync(directory);
    const report = await doctor(directory, {
      env: {
        NODE_ENV: 'production',
        QB_MASTER_KEY: sentinel,
        QB_PUBLIC_URL: `https://user:${sentinel}@example.com`,
        QB_STUDIO_URL: 'http://example.com',
        VITE_QB_MASTER_KEY: sentinel,
        QB_ALLOWED_ORIGINS: 'https://*.example.com',
        QB_PUSH_ENABLED: 'true',
      },
    });
    expect(report.exitStatus).toBe(1);
    expect(report.readOnly).toBe(true);
    expect(report.findings.some((f) => f.code === 'BROWSER_SECRET')).toBe(true);
    expect(report.findings.find((f) => f.code === 'RECOVERY_DESTINATION')?.status).toBe('unknown');
    expect(report.findings.find((f) => f.code === 'PUSH_WORKER_SECRET')?.status).toBe('fail');
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(JSON.stringify(report)).not.toContain(directory);
    expect(readdirSync(directory)).toEqual(before);
    const clean = await doctor(directory, { env: {} });
    expect(clean.exitStatus).toBe(0);
    expect(clean.findings.find((f) => f.code === 'PUSH_DISABLED')?.status).toBe('pass');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit readiness probe is bounded and refuses redirects or credential-bearing URLs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-doctor-probe-'));
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests++;
      expect(new URL(request.url).pathname).toBe('/ready');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/private' },
      });
    },
  });
  try {
    await doctor(directory, { env: {} });
    expect(requests).toBe(0);
    const report = await doctor(directory, {
      env: {},
      probeURL: `http://localhost:${server.port}`,
    });
    expect(requests).toBe(1);
    expect(report.exitStatus).toBe(1);
    await expect(
      doctor(directory, { env: {}, probeURL: 'https://user:secret@example.com' }),
    ).rejects.toThrow('bare HTTP(S)');
    expect(requests).toBe(1);
  } finally {
    server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('qb doctor emits structured reports and uses distinct invalid-invocation exit status', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-doctor-cli-'));
  try {
    const invoke = async (args: string[]) => {
      const child = Bun.spawn(
        [process.execPath, resolve('apps/cli/src/index.ts'), 'doctor', ...args],
        {
          cwd: directory,
          env: { PATH: process.env.PATH, NODE_ENV: 'development' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [out, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { value: JSON.parse(out), error, code };
    };
    const report = await invoke([]);
    expect(report.code).toBe(0);
    expect(report.value.readOnly).toBe(true);
    const invalid = await invoke(['--probe-url', 'https://user:secret-canary@example.com']);
    expect(invalid.code).toBe(2);
    expect(invalid.value.error.code).toBe('DOCTOR_INVOCATION');
    expect(JSON.stringify(invalid)).not.toContain('secret-canary');
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
