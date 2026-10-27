import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
import { createClient } from '@qbflex/client';

test('integration: aggregate query via /query endpoint', async () => {
  const f = await fixture();
  const proj = await f.project('agg-test');
  try {
    // Create a service key with bypass so we can seed and aggregate without app-user auth.
    const serviceKeyRes = await f.call(
      `/management/v1/projects/${proj.id}/keys`,
      'POST',
      {
        scope: 'service',
        branch: proj.branchId,
        tables: ['tasks'],
        methods: ['GET', 'POST'],
        bypass: true,
      },
      f.token,
    );
    const serviceClient = createClient({
      url: f.url,
      projectId: proj.id,
      branch: proj.branchId,
      publishableKey: serviceKeyRes.data.key,
    });

    // Seed data: owner-1 has 3 tasks (2 completed=1, 1 completed=0), owner-2 has 2 tasks (both completed=1)
    const tasks = [
      { owner_id: 'owner-1', title: 'Task A1', completed: 1, revision: 1 },
      { owner_id: 'owner-1', title: 'Task A2', completed: 0, revision: 1 },
      { owner_id: 'owner-1', title: 'Task A3', completed: 1, revision: 1 },
      { owner_id: 'owner-2', title: 'Task B1', completed: 1, revision: 1 },
      { owner_id: 'owner-2', title: 'Task B2', completed: 1, revision: 1 },
    ];
    for (const t of tasks) {
      await serviceClient.from('tasks').insert(t);
    }

    // Query: count tasks per owner
    const q1 = await serviceClient.from('tasks').groupBy(['owner_id']).aggregate('count', undefined, 'task_count').execute();
    expect(q1.data.length).toBe(2);
    const counts = q1.data.sort((a: any, b: any) => (a.owner_id > b.owner_id ? 1 : -1));
    expect(counts[0]).toEqual(expect.objectContaining({ owner_id: 'owner-1', task_count: 3 }));
    expect(counts[1]).toEqual(expect.objectContaining({ owner_id: 'owner-2', task_count: 2 }));

    // Query: sum of completed per owner
    const q2 = await serviceClient
      .from('tasks')
      .groupBy(['owner_id'])
      .aggregate('sum', 'completed', 'completed_sum')
      .execute();
    const sums = q2.data.sort((a: any, b: any) => (a.owner_id > b.owner_id ? 1 : -1));
    expect(sums[0]).toEqual(expect.objectContaining({ owner_id: 'owner-1', completed_sum: 2 }));
    expect(sums[1]).toEqual(expect.objectContaining({ owner_id: 'owner-2', completed_sum: 2 }));

    // Query: avg of completed per owner
    const q3 = await serviceClient
      .from('tasks')
      .groupBy(['owner_id'])
      .aggregate('avg', 'completed', 'avg_completed')
      .execute();
    const avgs = q3.data.sort((a: any, b: any) => (a.owner_id > b.owner_id ? 1 : -1));
    expect(avgs[0].avg_completed).toBeCloseTo(2 / 3);
    expect(avgs[1].avg_completed).toBeCloseTo(1);

    // Query: count distinct titles per owner
    const q4 = await serviceClient
      .from('tasks')
      .groupBy(['owner_id'])
      .aggregate('countDistinct', 'title', 'distinct_titles')
      .execute();
    const distinct = q4.data.sort((a: any, b: any) => (a.owner_id > b.owner_id ? 1 : -1));
    expect(distinct[0].distinct_titles).toBe(3);
    expect(distinct[1].distinct_titles).toBe(2);

    // Query: having clause filters groups
    const q5 = await serviceClient
      .from('tasks')
      .groupBy(['owner_id'])
      .aggregate('count', undefined, 'cnt')
      .having('cnt', 'gt', 2)
      .execute();
    expect(q5.data.length).toBe(1);
    expect(q5.data[0].owner_id).toBe('owner-1');

    // count meta returns number of groups
    const q6 = await serviceClient.from('tasks').groupBy(['owner_id']).aggregate('count', undefined, 'task_count').count().execute();
    expect(q6.meta.count).toBe(2);

    // No cursor returned in aggregate mode
    const q7 = await serviceClient.from('tasks').groupBy(['owner_id']).aggregate('count', undefined, 'task_count').limit(1).execute();
    expect(q7.meta.cursor).toBeUndefined();
    expect(q7.data.length).toBe(1);
  } finally {
    await f.close();
  }
});

test('integration: aggregate rejects unsupported combos via SDK', async () => {
  const f = await fixture();
  const proj = await f.project('agg-reject');
  try {
    // cursor with aggregates
    await expect(
      proj.client.from('tasks').groupBy(['owner_id']).aggregate('count', undefined, 'cnt').cursor('abc').execute(),
    ).rejects.toThrow('Cursor pagination not supported with aggregates');

    // relations with aggregates
    await expect(
      proj.client
        .from('tasks')
        .groupBy(['owner_id'])
        .aggregate('count', undefined, 'cnt')
        .include([{ name: 'rel' } as any])
        .execute(),
    ).rejects.toThrow('Relations not supported with aggregates');
  } finally {
    await f.close();
  }
});
