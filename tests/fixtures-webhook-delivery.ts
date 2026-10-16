import { deliverWebhook, parseInternalAllowlist } from '../apps/worker/src/webhook-delivery';
const url = process.argv[2]!;
const result = await deliverWebhook(
  {
    skipped: false,
    url,
    body: '{"exact":"body"}',
    headers: {
      'x-qb-event-id': 'fixture-event',
      'x-qb-timestamp': '123',
      'x-qb-signature': 'v1=fixture',
      authorization: 'must-not-forward',
      cookie: 'must-not-forward',
    },
  },
  { allowlist: parseInternalAllowlist(process.env.QB_WEBHOOK_INTERNAL_ALLOWLIST) },
);
console.log(JSON.stringify(result));
