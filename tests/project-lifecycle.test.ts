import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';

let f: Awaited<ReturnType<typeof fixture>> | undefined;

describe('Project lifecycle', () => {
  beforeEach(async () => {
    f = await fixture();
  });

  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it('deletes only the target project and leaves siblings and the workspace', async () => {
    const workspace = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Shared workspace' },
      f!.token,
    );
    const otherWorkspace = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Other workspace' },
      f!.token,
    );
    const doomed = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: workspace.data.id, name: 'Doomed', slug: 'doomed' },
      f!.token,
    );
    const sibling = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: workspace.data.id, name: 'Sibling', slug: 'sibling' },
      f!.token,
    );
    const outsider = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: otherWorkspace.data.id, name: 'Outsider', slug: 'outsider' },
      f!.token,
    );
    await f!.service.tick();
    await f!.service.tick();
    await f!.service.tick();

    const doomedDirectory = join(f!.directory, 'projects', doomed.data.id);
    const siblingDirectory = join(f!.directory, 'projects', sibling.data.id);
    const outsiderDirectory = join(f!.directory, 'projects', outsider.data.id);
    const doomedFunctions = join(f!.directory, 'functions', doomed.data.id);
    const siblingFunctions = join(f!.directory, 'functions', sibling.data.id);
    mkdirSync(doomedFunctions, { recursive: true });
    mkdirSync(siblingFunctions, { recursive: true });
    writeFileSync(join(doomedFunctions, 'marker.txt'), 'delete-me');
    writeFileSync(join(siblingFunctions, 'marker.txt'), 'keep-me');

    expect(existsSync(doomedDirectory)).toBe(true);
    expect(existsSync(siblingDirectory)).toBe(true);

    const deleted = await f!.response(
      `/management/v1/projects/${doomed.data.id}`,
      'DELETE',
      undefined,
      f!.token,
    );
    expect(deleted.status).toBe(204);

    expect(existsSync(doomedDirectory)).toBe(false);
    expect(existsSync(doomedFunctions)).toBe(false);
    expect(existsSync(siblingDirectory)).toBe(true);
    expect(existsSync(siblingFunctions)).toBe(true);
    expect(existsSync(outsiderDirectory)).toBe(true);
    expect(readdirSync(join(f!.directory, 'projects'))).toContain(sibling.data.id);
    expect(readdirSync(join(f!.directory, 'projects'))).toContain(outsider.data.id);
    expect(readdirSync(join(f!.directory, 'projects'))).not.toContain(doomed.data.id);

    const remainingProjects = await f!.call('/management/v1/projects', 'GET', undefined, f!.token);
    const remainingIds = remainingProjects.data.map((item: { id: string }) => item.id);
    expect(remainingIds).toContain(sibling.data.id);
    expect(remainingIds).toContain(outsider.data.id);
    expect(remainingIds).not.toContain(doomed.data.id);

    const remainingOrgs = await f!.call('/management/v1/organizations', 'GET', undefined, f!.token);
    expect(remainingOrgs.data.some((item: { id: string }) => item.id === workspace.data.id)).toBe(
      true,
    );
    expect(
      remainingOrgs.data.some((item: { id: string }) => item.id === otherWorkspace.data.id),
    ).toBe(true);

    const token = await f!.call('/management/v1/tokens', 'POST', { readOnly: true }, f!.token);
    const denied = await f!.response(
      `/management/v1/projects/${sibling.data.id}`,
      'DELETE',
      undefined,
      token.data.token,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('TOKEN_SCOPE');
  });
});
