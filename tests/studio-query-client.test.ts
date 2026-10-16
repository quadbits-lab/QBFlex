import { expect, test } from 'bun:test';
import { QueryObserver } from '@tanstack/react-query';
import { createStudioQueryClient, refreshStudioQueries } from '../apps/studio/src/query-client';

test('successful Studio submissions await fresh lists and summaries before local success callbacks', async () => {
  const client = createStudioQueryClient(() => {});
  let documents = 0,
    listReads = 0,
    summaryReads = 0,
    localSuccess = false;
  let started!: () => void, release!: () => void;
  const refreshing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  client.setQueryData(['objects', 'branch', 'bucket'], []);
  client.setQueryData(['audit'], 0);
  const list = new QueryObserver(client, {
    queryKey: ['objects', 'branch', 'bucket'],
    staleTime: Infinity,
    queryFn: async () => {
      listReads++;
      return Array.from({ length: documents }, (_, id) => ({ id }));
    },
  });
  const summary = new QueryObserver(client, {
    queryKey: ['audit'],
    staleTime: Infinity,
    queryFn: async () => {
      summaryReads++;
      started();
      await held;
      return documents;
    },
  });
  const stopList = list.subscribe(() => {}),
    stopSummary = summary.subscribe(() => {});
  try {
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        documents++;
        return { id: 'created' };
      },
      onSuccess: () => {
        localSuccess = true;
      },
    });
    const submitted = mutation.execute(undefined);
    await refreshing;
    expect(mutation.state.status).toBe('pending');
    expect(localSuccess).toBe(false);
    release();
    await expect(submitted).resolves.toEqual({ id: 'created' });
    expect(localSuccess).toBe(true);
    expect(listReads).toBe(1);
    expect(summaryReads).toBe(1);
    expect(client.getQueryData<{ id: number }[]>(['objects', 'branch', 'bucket'])).toEqual([
      { id: 0 },
    ]);
    expect(client.getQueryData<number>(['audit'])).toBe(1);
  } finally {
    release();
    stopList();
    stopSummary();
    client.clear();
  }
});

test('imperative uploads refresh active views and invalidate inactive views without fetching disabled queries', async () => {
  const client = createStudioQueryClient(() => {});
  client.setQueryData(['objects'], ['old']);
  client.setQueryData(['overview'], 0);
  let disabledReads = 0;
  const active = new QueryObserver(client, {
    queryKey: ['objects'],
    staleTime: Infinity,
    queryFn: async () => ['uploaded'],
  });
  const disabled = new QueryObserver(client, {
    queryKey: ['disabled'],
    enabled: false,
    queryFn: async () => {
      disabledReads++;
      return 1;
    },
  });
  const stopActive = active.subscribe(() => {}),
    stopDisabled = disabled.subscribe(() => {});
  try {
    await refreshStudioQueries(client);
    expect(client.getQueryData<string[]>(['objects'])).toEqual(['uploaded']);
    expect(client.getQueryState(['overview'])?.isInvalidated).toBe(true);
    expect(client.getQueryData<number>(['overview'])).toBe(0);
    expect(disabledReads).toBe(0);
    expect(
      await client.fetchQuery<number>({
        queryKey: ['overview'],
        queryFn: async () => 1,
        staleTime: Infinity,
      }),
    ).toBe(1);
  } finally {
    stopActive();
    stopDisabled();
    client.clear();
  }
});

test('cancelled pre-submission reads cannot overwrite newer data even when their transport ignores abort', async () => {
  const client = createStudioQueryClient(() => {});
  let reads = 0,
    firstSignal: AbortSignal | undefined,
    oldResult!: (value: string[]) => void;
  const observer = new QueryObserver(client, {
    queryKey: ['rows'],
    queryFn: ({ signal }) => {
      reads++;
      if (reads === 1) {
        firstSignal = signal;
        return new Promise<string[]>((resolve) => {
          oldResult = resolve;
        });
      }
      return Promise.resolve(['new-document']);
    },
  });
  const stop = observer.subscribe(() => {});
  try {
    const mutation = client.getMutationCache().build(client, { mutationFn: async () => 'saved' });
    await mutation.execute(undefined);
    expect(firstSignal?.aborted).toBe(true);
    expect(reads).toBe(2);
    expect(client.getQueryData<string[]>(['rows'])).toEqual(['new-document']);
    oldResult(['stale-document']);
    await Bun.sleep(0);
    expect(client.getQueryData<string[]>(['rows'])).toEqual(['new-document']);
  } finally {
    stop();
    client.clear();
  }
});

test('failed submissions do not refresh or clear data; failed reads do not falsely fail acknowledged writes', async () => {
  const reported: string[] = [];
  const client = createStudioQueryClient((error) => {
    reported.push(error.message);
  });
  client.setQueryData(['rows'], ['retained']);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['rows'],
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      throw new Error('Refresh unavailable');
    },
  });
  const stop = observer.subscribe(() => {});
  try {
    const rejected = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('Validation failed');
      },
    });
    await expect(rejected.execute(undefined)).rejects.toThrow('Validation failed');
    expect(reads).toBe(0);
    expect(reported).toEqual(['Validation failed']);
    expect(client.getQueryData<string[]>(['rows'])).toEqual(['retained']);
    const accepted = client.getMutationCache().build(client, { mutationFn: async () => 'saved' });
    await expect(accepted.execute(undefined)).resolves.toBe('saved');
    expect(accepted.state.status).toBe('success');
    expect(reads).toBe(1);
    expect(client.getQueryState(['rows'])?.error?.message).toBe('Refresh unavailable');
    expect(client.getQueryData<string[]>(['rows'])).toEqual(['retained']);
  } finally {
    stop();
    client.clear();
  }
});

test('Studio caches remain request-local', () => {
  const first = createStudioQueryClient(() => {}),
    second = createStudioQueryClient(() => {});
  try {
    first.setQueryData(['platform-session'], { user: { id: 'first' } });
    expect(second.getQueryData(['platform-session'])).toBeUndefined();
  } finally {
    first.clear();
    second.clear();
  }
});
