import { test, expect } from 'bun:test';
import { fixture } from './helpers';

test('alert rules CRUD and notifications lifecycle', async () => {
  const f = await fixture();
  const org = f.organizations[0];
  try {
    // Create an alert rule.
    const rule = await f.call(
      `/management/v1/organizations/${org.id}/alert-rules`,
      'POST',
      {
        name: 'Error count alert',
        kind: 'error_count',
        config: { threshold: 1 },
        severity: 'warning',
        channels: [{ type: 'email', to: 'alerts@example.com' }],
      },
      f.token,
    );
    expect(rule.data.name).toBe('Error count alert');
    expect(rule.data.kind).toBe('error_count');
    expect(rule.data.enabled).toBe(true);

    // List rules.
    const list = await f.call(`/management/v1/organizations/${org.id}/alert-rules`, 'GET', undefined, f.token);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].id).toBe(rule.data.id);

    // Read rule.
    const read = await f.call(
      `/management/v1/organizations/${org.id}/alert-rules/${rule.data.id}`,
      'GET',
      undefined,
      f.token,
    );
    expect(read.data.id).toBe(rule.data.id);

    // Trigger maintenance without errors: no notification.
    await f.service.maintain();
    const empty = await f.call(`/management/v1/organizations/${org.id}/notifications`, 'GET', undefined, f.token);
    expect(empty.data).toHaveLength(0);

    // Cause a request error on the public API so metrics register an error.
    const proj = await f.project('alert-proj');
    await f.response(
      `/v1/projects/${proj.id}/branches/${proj.branchId}/data/nonexistent_table`,
      'GET',
      undefined,
      undefined,
      { 'x-qb-key': proj.key },
    );
    await f.service.maintain();

    // Notification should now exist.
    const fired = await f.call(`/management/v1/organizations/${org.id}/notifications`, 'GET', undefined, f.token);
    expect(fired.data.length).toBeGreaterThanOrEqual(1);
    expect(fired.data[0].severity).toBe('warning');
    expect(fired.data[0].title).toBe('Error count alert');

    // A second tick should be silenced (no new notification).
    await f.service.maintain();
    const afterSilence = await f.call(`/management/v1/organizations/${org.id}/notifications`, 'GET', undefined, f.token);
    expect(afterSilence.data.length).toBe(fired.data.length);

    // Mark notification read.
    const mark = await f.call(
      `/management/v1/organizations/${org.id}/notifications/${fired.data[0].id}/read`,
      'POST',
      {},
      f.token,
    );
    expect(mark.data.id).toBe(fired.data[0].id);
    expect(mark.data.readAt).toBeDefined();

    // Delete rule.
    const del = await f.response(
      `/management/v1/organizations/${org.id}/alert-rules/${rule.data.id}`,
      'DELETE',
      undefined,
      f.token,
    );
    expect(del.status).toBe(204);
  } finally {
    await f.close();
  }
});

test('alert rule validation rejects invalid input', async () => {
  const f = await fixture();
  const org = f.organizations[0];
  try {
    await expect(
      f.call(`/management/v1/organizations/${org.id}/alert-rules`, 'POST', {}, f.token),
    ).rejects.toThrow();
    await expect(
      f.call(
        `/management/v1/organizations/${org.id}/alert-rules`,
        'POST',
        { name: 'x', kind: 'unknown', config: { threshold: 1 }, severity: 'warning', channels: [] },
        f.token,
      ),
    ).rejects.toThrow();
    await expect(
      f.call(
        `/management/v1/organizations/${org.id}/alert-rules`,
        'POST',
        { name: 'x', kind: 'error_count', config: {}, severity: 'warning', channels: [] },
        f.token,
      ),
    ).rejects.toThrow();
  } finally {
    await f.close();
  }
});
