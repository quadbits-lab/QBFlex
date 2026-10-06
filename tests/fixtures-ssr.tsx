import { renderToString } from 'react-dom/server';
import { createClient } from '@qb-flex/client';
import { QBProvider, useQBAuth, useQBClient } from '@qb-flex/react';
let requests = 0;
const client = (projectId: string) =>
  createClient({
    url: 'http://localhost:7612',
    projectId,
    publishableKey: 'test',
    fetch: async () => {
      requests++;
      throw new Error('SSR performed a browser request');
    },
  });
function Outside() {
  useQBClient();
  return null;
}
let boundary = false;
try {
  renderToString(<Outside />);
} catch (error) {
  boundary = (error as Error).message.includes('QBProvider');
}
function State() {
  return <span>{useQBAuth().user?.id ?? 'anonymous'}</span>;
}
const a = client('a'),
  b = client('b');
const first = renderToString(
    <QBProvider client={a}>
      <State />
    </QBProvider>,
  ),
  second = renderToString(
    <QBProvider client={b}>
      <State />
    </QBProvider>,
  );
console.log(
  JSON.stringify({
    boundary,
    first,
    second,
    requests,
    browserGlobals: typeof window !== 'undefined',
  }),
);
a.dispose();
b.dispose();
