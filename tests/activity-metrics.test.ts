import { describe, expect, test } from 'bun:test';
import {
  activitySeries,
  activitySummary,
  countBy,
  projectAuditEvents,
  type AuditEvent,
} from '../apps/studio/src/workspaces/activity-metrics';

const day = (offset: number, hour = 12) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString();
};

const events: AuditEvent[] = [
  {
    id: '1',
    project_id: 'p1',
    action: 'create',
    resource: 'table',
    result: 'ok',
    time: day(0),
  },
  {
    id: '2',
    project_id: 'p1',
    action: 'create',
    resource: 'policy',
    result: 'error',
    time: day(0),
  },
  {
    id: '3',
    project_id: 'p1',
    action: 'update',
    resource: 'table',
    result: 'ok',
    time: day(-1),
  },
  {
    id: '4',
    project_id: 'p2',
    action: 'delete',
    resource: 'key',
    result: 'ok',
    time: day(0),
  },
];

describe('activity-metrics', () => {
  test('filters events to the selected project', () => {
    expect(projectAuditEvents(events, 'p1')).toHaveLength(3);
    expect(projectAuditEvents(events, 'p2')).toHaveLength(1);
  });

  test('builds a fixed-length daily series with success and failure counts', () => {
    const series = activitySeries(projectAuditEvents(events, 'p1'), 3);
    expect(series).toHaveLength(3);
    expect(series.at(-1)).toMatchObject({ events: 2, success: 1, failure: 1 });
    expect(series.at(-2)).toMatchObject({ events: 1, success: 1, failure: 0 });
  });

  test('counts top labels by key', () => {
    expect(countBy(projectAuditEvents(events, 'p1'), 'action')).toEqual([
      { name: 'create', label: 'create', value: 2 },
      { name: 'update', label: 'update', value: 1 },
    ]);
  });

  test('summarizes totals, failures, and success rate', () => {
    expect(activitySummary(projectAuditEvents(events, 'p1'))).toMatchObject({
      total: 3,
      failures: 1,
      successRate: 67,
      actions: 2,
    });
  });
});
