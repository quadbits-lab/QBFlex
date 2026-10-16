import { test, expect } from 'bun:test';
import {
  UploadQueue,
  UPLOAD_VISIBLE_LIMIT,
  type UploadAttempt,
} from '../apps/studio/src/upload-queue';
import { uploadBytes } from '../apps/studio/src/upload-transfer';
const target = {
  base: '/projects/p/branches/immutable',
  bucketId: 'bucket',
  bucketName: 'public',
  projectName: 'Project',
  branchName: 'main',
};
const files = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => new File(['test bytes'], `file-${index}.txt`, { type: 'text/plain' }),
  );
function controlled() {
  const calls: { attempt: UploadAttempt; resolve: () => void; reject: (error: Error) => void }[] =
    [];
  const refreshed: string[] = [];
  const queue = new UploadQueue(
    (attempt) =>
      new Promise((resolve, reject) => {
        calls.push({ attempt, resolve, reject });
        attempt.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Canceled', 'AbortError')),
          { once: true },
        );
      }),
    async (value) => {
      refreshed.push(value.base);
    },
    { concurrency: 2, completedMs: 15, exitMs: 5, maxItems: 100 },
  );
  queue.setIdentity('owner');
  return { queue, calls, refreshed };
}

test('queue runs two transfers, shows at most five, then removes success and promotes pending items in order', async () => {
  const { queue, calls, refreshed } = controlled();
  try {
    const ids = queue.enqueue(files(8), target);
    expect(calls).toHaveLength(2);
    expect(queue.getSnapshot().filter((item) => item.state === 'queued')).toHaveLength(6);
    expect(
      queue
        .getSnapshot()
        .slice(0, UPLOAD_VISIBLE_LIMIT)
        .map((item) => item.id),
    ).toEqual(ids.slice(0, 5));
    calls[0]!.attempt.onProgress(4);
    expect(queue.getSnapshot()[0]!.sent).toBe(4);
    calls[0]!.attempt.onFinalizing();
    expect(queue.getSnapshot()[0]!.state).toBe('finalizing');
    expect(queue.getSnapshot()[0]!.state).not.toBe('completed');
    calls[0]!.resolve();
    await Bun.sleep(0);
    expect(calls).toHaveLength(3);
    expect(refreshed).toEqual([target.base]);
    expect(queue.getSnapshot()[0]!.state).toBe('completed');
    await Bun.sleep(18);
    expect(queue.getSnapshot()[0]!.leaving).toBe(true);
    await Bun.sleep(8);
    expect(
      queue
        .getSnapshot()
        .slice(0, 5)
        .map((item) => item.id),
    ).toEqual(ids.slice(1, 6));
    calls[0]!.attempt.onProgress(1);
    calls[0]!.attempt.onFinalizing();
    expect(queue.getSnapshot().some((item) => item.id === ids[0])).toBe(false);
  } finally {
    queue.clear();
  }
});

test('failed uploads retain details; manual retry reuses the original intent, file and immutable target', async () => {
  const { queue, calls } = controlled();
  try {
    const captured = { ...target };
    const id = queue.enqueue(files(1), captured)[0]!;
    captured.base = '/projects/other/branches/other';
    calls[0]!.attempt.onIntent('object-original');
    calls[0]!.reject(new Error('Storage temporarily unavailable'));
    await Bun.sleep(0);
    expect(queue.getSnapshot()[0]!.state).toBe('failed');
    expect(queue.getSnapshot()[0]!.error).toContain('temporarily unavailable');
    await Bun.sleep(25);
    expect(queue.getSnapshot()).toHaveLength(1);
    queue.retry(id);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.attempt.objectId).toBe('object-original');
    expect(calls[1]!.attempt.intentKey).toBe(calls[0]!.attempt.intentKey);
    expect(calls[1]!.attempt.target.base).toBe(target.base);
    expect(calls[1]!.attempt.file).toBe(calls[0]!.attempt.file);
    calls[0]!.attempt.onFinalizing();
    expect(queue.getSnapshot()[0]!.state).toBe('uploading');
  } finally {
    queue.clear();
  }
});

test('canceling pending or active work releases queue slots; identity changes abort and ignore late callbacks', async () => {
  const { queue, calls } = controlled();
  const ids = queue.enqueue(files(4), target);
  queue.cancel(ids[2]!);
  expect(calls).toHaveLength(2);
  queue.cancel(ids[0]!);
  await Bun.sleep(0);
  expect(calls[0]!.attempt.signal.aborted).toBe(true);
  expect(calls).toHaveLength(3);
  expect(calls[2]!.attempt.file.name).toBe('file-3.txt');
  queue.setIdentity('another-owner');
  expect(calls[1]!.attempt.signal.aborted).toBe(true);
  expect(queue.getSnapshot()).toEqual([]);
  calls[1]!.attempt.onProgress(10);
  calls[1]!.attempt.onFinalizing();
  calls[1]!.resolve();
  await Bun.sleep(0);
  expect(queue.getSnapshot()).toEqual([]);
  queue.enqueue(files(1), target);
  expect(calls).toHaveLength(4);
  queue.setIdentity(null);
  expect(() => queue.enqueue(files(1), target)).toThrow('Sign in');
  queue.clear();
});

test('queue capacity rejects the whole selection and failed refresh never retries a committed upload', async () => {
  const { queue } = controlled();
  try {
    expect(() => queue.enqueue(files(101), target)).toThrow('up to 100');
    expect(queue.getSnapshot()).toHaveLength(0);
  } finally {
    queue.clear();
  }
  let attempts = 0;
  const completed = new UploadQueue(
    async () => {
      attempts++;
    },
    async () => {
      throw new Error('Read unavailable');
    },
  );
  completed.setIdentity('owner');
  completed.enqueue(files(1), target);
  await Bun.sleep(0);
  expect(completed.getSnapshot()[0]!.state).toBe('completed');
  expect(attempts).toBe(1);
  completed.clear();
});

function xhrFixture() {
  const xhr = {
    upload: { onprogress: null as any, onload: null as any },
    onload: null as any,
    onerror: null as any,
    onabort: null as any,
    ontimeout: null as any,
    responseText: '',
    status: 200,
    withCredentials: false,
    timeout: 0,
    body: undefined as Blob | undefined,
    headers: {} as Record<string, string>,
    open() {},
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body: Blob) {
      this.body = body;
    },
    abort() {
      this.onabort?.();
    },
  };
  return xhr;
}
test('upload transport reports bytes and finalizing separately, requires ready acknowledgement and sends cookies', async () => {
  const xhr = xhrFixture();
  const progress: number[] = [];
  let saving = false;
  const attempt: UploadAttempt = {
    file: files(1)[0]!,
    target,
    signal: new AbortController().signal,
    intentKey: 'intent',
    onIntent() {},
    onProgress: (sent) => {
      progress.push(sent);
    },
    onFinalizing: () => {
      saving = true;
    },
  };
  let done = false;
  const result = uploadBytes('http://localhost/isolated', attempt, () => xhr as any).then(() => {
    done = true;
  });
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.body).toBe(attempt.file);
  expect(xhr.headers['Content-Type']).toBe(attempt.file.type);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 5 });
  xhr.upload.onload();
  expect(progress).toEqual([5]);
  expect(saving).toBe(true);
  expect(done).toBe(false);
  xhr.responseText = JSON.stringify({ data: { state: 'ready' } });
  xhr.onload();
  await result;
  expect(done).toBe(true);
  expect(xhr.upload.onprogress).toBeNull();
  const invalid = xhrFixture();
  const rejected = uploadBytes('http://localhost/isolated', attempt, () => invalid as any);
  invalid.responseText = JSON.stringify({ data: { state: 'pending' } });
  invalid.onload();
  await expect(rejected).rejects.toThrow('did not confirm');
  const canceled = xhrFixture();
  const abort = new AbortController();
  const stopped = uploadBytes(
    'http://localhost/isolated',
    { ...attempt, signal: abort.signal },
    () => canceled as any,
  );
  abort.abort();
  await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
  expect(canceled.onload).toBeNull();
});
