import { expect, test } from 'bun:test';
import { fixture } from './helpers';

test('administrators can rename a project and keep the local region', async () => {
  const f = await fixture();
  try {
    const created = await f.call(
      '/management/v1/projects',
      'POST',
      { organizationId: f.organizations[0].id, name: 'Original', slug: 'original' },
      f.token,
    );
    await f.service.tick();
    const updated = await f.call(
      '/management/v1/projects/' + created.data.id,
      'PATCH',
      { name: ' Renamed ', region: 'local' },
      f.token,
    );
    expect(updated.data).toMatchObject({
      id: created.data.id,
      name: 'Renamed',
      slug: 'original',
      region: 'local',
      status: 'ready',
    });
    const listed = await f.call('/management/v1/projects', 'GET', undefined, f.token);
    const project = listed.data.find((item: { id: string }) => item.id === created.data.id);
    expect(project).toMatchObject({ name: 'Renamed', slug: 'original', region: 'local' });

    const blank = await f.response(
      '/management/v1/projects/' + created.data.id,
      'PATCH',
      { name: '   ' },
      f.token,
    );
    expect(blank.status).toBe(400);
    expect((await blank.json()).error.code).toBe('VALIDATION');

    const moved = await f.response(
      '/management/v1/projects/' + created.data.id,
      'PATCH',
      { region: 'us-east-1' },
      f.token,
    );
    expect(moved.status).toBe(400);
    expect((await moved.json()).error.code).toBe('VALIDATION');

    const unchanged = await f.call('/management/v1/projects', 'GET', undefined, f.token);
    expect(
      unchanged.data.find((item: { id: string }) => item.id === created.data.id),
    ).toMatchObject({ name: 'Renamed', region: 'local' });

    const token = await f.call('/management/v1/tokens', 'POST', { readOnly: true }, f.token);
    const denied = await f.response(
      '/management/v1/projects/' + created.data.id,
      'PATCH',
      { name: 'Nope' },
      token.data.token,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('TOKEN_SCOPE');
  } finally {
    await f.close();
  }
});
