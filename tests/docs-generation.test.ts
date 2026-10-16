import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Docs mirrors the specification and rejects stale search, sitemap, robots and references', () => {
  // Run the real generator against isolated fixtures; never mutate checkout artifacts.
  const directory = mkdtempSync(join(tmpdir(), 'qb-docs-generation-'));
  const generator = resolve('scripts/docs.ts');
  const run = (check = false) =>
    Bun.spawnSync([process.execPath, generator, ...(check ? ['--check'] : [])], {
      cwd: directory,
      env: { ...process.env, QB_DOCS_URL: 'https://docs.example.test' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
  try {
    for (const folder of [
      'apps/docs/content',
      'docs/benchmarks',
      'packages/sdk-js/dist',
      'packages/sdk-react/dist',
    ])
      mkdirSync(join(directory, folder), { recursive: true });
    const spec =
      '# Platform specification\n\nSpecification version: **1.1**\n\n## Accepted requirements\n\nSee [status](docs/expanded-release-status.md).\n';
    writeFileSync(join(directory, 'qb-flex-development-spec.md'), spec);
    writeFileSync(join(directory, 'docs/benchmarks/linux-arm64.json'), '{}\n');
    for (const sdk of ['sdk-js', 'sdk-react'])
      writeFileSync(
        join(directory, `packages/${sdk}/dist/index.d.ts`),
        'export declare const version: string;\n',
      );
    writeFileSync(
      join(directory, 'apps/docs/content/status.mdx'),
      'export const frontmatter = {"title":"Status","description":"Status","section":"Roadmap","slug":"roadmap/expanded-release","order":100};\n\n# Status\n',
    );
    expect(run().exitCode).toBe(0);
    expect(run(true).exitCode).toBe(0);
    const mirror = readFileSync(
      join(directory, 'apps/docs/content/reference/development-spec.mdx'),
      'utf8',
    );
    expect(mirror).toContain('Specification version: **1.1**');
    expect(mirror).toContain('(/docs/roadmap/expanded-release)');
    for (const file of ['search-index.json', 'sitemap.xml', 'robots.txt']) {
      const path = join(directory, 'apps/docs/public', file);
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, original + '\nSTALE');
      const result = run(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(
        `Documentation asset is stale: apps/docs/public/${file}`,
      );
      writeFileSync(path, original);
    }
    writeFileSync(
      join(directory, 'qb-flex-development-spec.md'),
      spec.replace('**1.1**', '**1.2**') + '\nNew accepted requirement.\n',
    );
    const staleSpec = run(true);
    expect(staleSpec.exitCode).not.toBe(0);
    expect(staleSpec.stderr.toString()).toContain(
      'Generated docs are stale: apps/docs/content/reference/development-spec.mdx',
    );
    expect(run().exitCode).toBe(0);
    expect(run(true).exitCode).toBe(0);
    expect(
      readFileSync(join(directory, 'apps/docs/content/reference/development-spec.mdx'), 'utf8'),
    ).toContain('Specification 1.2: expanded-release requirements');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
