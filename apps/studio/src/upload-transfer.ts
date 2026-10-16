import { apiURL, management } from './api';
import type { UploadAttempt } from './upload-queue';

/** XHR reports actual browser-to-API bytes; storage finalization is acknowledged separately. */
export function uploadBytes(
  url: string,
  attempt: UploadAttempt,
  createXHR = () => new XMLHttpRequest(),
) {
  return new Promise<void>((resolve, reject) => {
    if (attempt.signal.aborted) {
      reject(new DOMException('Upload canceled', 'AbortError'));
      return;
    }
    const xhr = createXHR();
    const cleanup = () => {
      attempt.signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      fail(new DOMException('Upload canceled', 'AbortError'));
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) attempt.onProgress(event.loaded);
    };
    xhr.upload.onload = () => attempt.onFinalizing();
    xhr.onerror = () =>
      fail(new Error('Connection lost during upload. Check your connection and retry.'));
    xhr.ontimeout = () => fail(new Error('Upload timed out. Check your connection and retry.'));
    xhr.onabort = () => fail(new DOMException('Upload canceled', 'AbortError'));
    xhr.onload = () => {
      let value: any;
      try {
        value = JSON.parse(xhr.responseText);
      } catch {
        fail(new Error('The server returned an invalid upload response.'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new Error(value?.error?.message ?? 'Upload failed. Try again.'));
        return;
      }
      if (value?.data?.state !== 'ready') {
        fail(
          new Error(
            'The server did not confirm that the file is ready. Retry to verify the upload.',
          ),
        );
        return;
      }
      cleanup();
      resolve();
    };
    try {
      xhr.open('PUT', url);
      xhr.withCredentials = true;
      xhr.timeout = 180_000;
      xhr.setRequestHeader('Content-Type', attempt.file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Request-ID', crypto.randomUUID());
      attempt.signal.addEventListener('abort', abort, { once: true });
      if (attempt.signal.aborted) abort();
      else xhr.send(attempt.file);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Could not start upload.'));
    }
  });
}

export async function transferQueuedUpload(attempt: UploadAttempt) {
  let objectId = attempt.objectId;
  if (!objectId) {
    const result = await management.request<{ id: string }>(
      `${attempt.target.base}/buckets/${attempt.target.bucketId}/objects`,
      'POST',
      {
        key: attempt.file.name,
        size: attempt.file.size,
        mime: attempt.file.type || 'application/octet-stream',
      },
      attempt.signal,
      { 'Idempotency-Key': attempt.intentKey },
    );
    objectId = result.data.id;
    attempt.onIntent(objectId);
  }
  await uploadBytes(
    `${apiURL}/management/v1${attempt.target.base}/objects/${objectId}/content`,
    attempt,
  );
}
