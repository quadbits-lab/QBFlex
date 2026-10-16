import { expect, test } from 'bun:test';
import { Metrics } from '@qb-flex/observability';

test('private histograms retain old counters and expose cumulative boundary buckets', () => {
  const metrics = new Metrics();
  metrics.record('GET', '/health', 200, 5);
  metrics.record('GET', '/health', 500, 10);
  metrics.record('GET', '/health', 200, 40000);
  metrics.record('GET', '/health', 200, NaN);
  const output = metrics.render({ active_owners: 2 });
  expect(output).toContain('qb_http_requests_total{route="GET /health"} 3');
  expect(output).toContain('qb_http_errors_total{route="GET /health"} 1');
  expect(output).toContain(
    'qb_http_request_duration_seconds_bucket{route="GET /health",le="0.005"} 1',
  );
  expect(output).toContain(
    'qb_http_request_duration_seconds_bucket{route="GET /health",le="0.01"} 2',
  );
  expect(output).toContain(
    'qb_http_request_duration_seconds_bucket{route="GET /health",le="+Inf"} 3',
  );
  expect(output).toContain('qb_http_request_duration_seconds_count{route="GET /health"} 3');
  expect(output).toContain('qb_active_owners 2');
});

test('labels never contain user-controlled keys, tokens, query values or arbitrary gauge names', () => {
  const metrics = new Metrics();
  for (let i = 0; i < 1000; i++) {
    metrics.record(
      'DELETE',
      `/v1/projects/private-${i}/branches/secret/data/table-${i}/hidden-key-${i}?password=canary`,
      200,
      2,
    );
    metrics.record('GET', `/attacker/${i}/secret-token`, 404, 1);
  }
  const output = metrics.render({ 'unsafe\nname': 1, invalid: Infinity });
  expect(output).not.toMatch(/secret|private-|table-\d|canary|hidden-key|unsafe|Infinity/);
  expect(output).toContain('DELETE /v1/projects/:projectId/branches/:branchId/data/:table/:key');
  expect(output).toContain('GET /:other');
  expect(output.match(/qb_http_requests_total\{/g)).toHaveLength(2);
});
