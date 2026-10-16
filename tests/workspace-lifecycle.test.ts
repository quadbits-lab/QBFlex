import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';

let f: Awaited<ReturnType<typeof fixture>> | undefined;

describe('Workspace lifecycle', () => {
  beforeEach(async () => {
    f = await fixture();
  });

  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it('updates workspace avatar and name', async () => {
    const workspace = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Avatar workspace' },
      f!.token,
    );
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const updated = await f!.call(
      `/management/v1/organizations/${workspace.data.id}`,
      'PATCH',
      { name: 'Avatar workspace renamed', image },
      f!.token,
    );
    expect(updated.data).toMatchObject({
      name: 'Avatar workspace renamed',
      image,
    });
    const listed = await f!.call('/management/v1/organizations', 'GET', undefined, f!.token);
    const row = listed.data.find((item: { id: string }) => item.id === workspace.data.id);
    expect(row).toMatchObject({ name: 'Avatar workspace renamed', image });
  });

  it('archives and restores a workspace without deleting projects', async () => {
    const workspace = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Archive me' },
      f!.token,
    );
    const project = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: workspace.data.id, name: 'kept', slug: 'kept' },
      f!.token,
    );
    await f!.service.tick();
    await f!.call(
      `/management/v1/organizations/${workspace.data.id}/archive`,
      'POST',
      undefined,
      f!.token,
    );
    const archived = await f!.call(
      `/management/v1/organizations/${workspace.data.id}`,
      'GET',
      undefined,
      f!.token,
    );
    expect(archived.data.archived_at).toBeTruthy();
    expect(
      (await f!.call('/management/v1/projects', 'GET', undefined, f!.token)).data.some(
        (item: { id: string }) => item.id === project.data.id,
      ),
    ).toBe(true);
    await f!.call(
      `/management/v1/organizations/${workspace.data.id}/unarchive`,
      'POST',
      undefined,
      f!.token,
    );
    const restored = await f!.call(
      `/management/v1/organizations/${workspace.data.id}`,
      'GET',
      undefined,
      f!.token,
    );
    expect(restored.data.archived_at).toBeNull();
  });

  it('removes only workspace-owned project data, functions and leaves other workspaces', async () => {
    const workspace = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Workspace to delete' },
      f!.token,
    );
    const workspace2 = await f!.call(
      '/management/v1/organizations',
      'POST',
      { name: 'Workspace keep' },
      f!.token,
    );
    const projects = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: workspace.data.id, name: 'project', slug: 'project' },
      f!.token,
    );
    const projects2 = await f!.call(
      '/management/v1/projects',
      'POST',
      { organizationId: workspace2.data.id, name: 'project', slug: 'project' },
      f!.token,
    );
    await f!.service.tick();
    await f!.service.tick();

    const projectDirectory = join(f!.directory, 'projects', projects.data.id);
    const keepDirectory = join(f!.directory, 'projects', projects2.data.id);
    const functionsDirectory = join(f!.directory, 'functions', projects.data.id);
    const keepFunctions = join(f!.directory, 'functions', projects2.data.id);
    mkdirSync(functionsDirectory, { recursive: true });
    mkdirSync(keepFunctions, { recursive: true });
    writeFileSync(join(functionsDirectory, 'marker.txt'), 'delete-me');
    writeFileSync(join(keepFunctions, 'marker.txt'), 'keep-me');

    expect(existsSync(projectDirectory)).toBe(true);
    expect(existsSync(keepDirectory)).toBe(true);

    const deleted = await f!.response(
      `/management/v1/organizations/${workspace.data.id}`,
      'DELETE',
      undefined,
      f!.token,
    );
    expect(deleted.status).toBe(204);

    expect(existsSync(projectDirectory)).toBe(false);
    expect(existsSync(functionsDirectory)).toBe(false);
    expect(existsSync(keepDirectory)).toBe(true);
    expect(existsSync(keepFunctions)).toBe(true);
    expect(readdirSync(join(f!.directory, 'projects'))).toContain(projects2.data.id);
    expect(readdirSync(join(f!.directory, 'projects'))).not.toContain(projects.data.id);

    const remainingProjects = await f!.call('/management/v1/projects', 'GET', undefined, f!.token);
    const remainingIds = remainingProjects.data.map((item: { id: string }) => item.id);
    expect(remainingIds).toContain(projects2.data.id);
    expect(remainingIds).not.toContain(projects.data.id);

    const remainingOrgs = await f!.call('/management/v1/organizations', 'GET', undefined, f!.token);
    expect(remainingOrgs.data.some((item: { id: string }) => item.id === workspace.data.id)).toBe(
      false,
    );
    expect(remainingOrgs.data.some((item: { id: string }) => item.id === workspace2.data.id)).toBe(
      true,
    );
  });
});
