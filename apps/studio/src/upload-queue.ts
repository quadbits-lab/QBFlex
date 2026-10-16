export const UPLOAD_VISIBLE_LIMIT = 5;
export type UploadTarget = {
  base: string;
  bucketId: string;
  bucketName: string;
  projectName: string;
  branchName: string;
};
export type UploadState =
  'queued' | 'uploading' | 'finalizing' | 'completed' | 'failed' | 'canceled';
export type UploadItem = {
  id: string;
  name: string;
  size: number;
  target: UploadTarget;
  state: UploadState;
  sent: number;
  speed: number;
  error?: string;
  leaving: boolean;
};
type Task = { file?: File; objectId?: string; intentKey: string; controller?: AbortController };
export type UploadAttempt = {
  file: File;
  target: UploadTarget;
  signal: AbortSignal;
  objectId?: string;
  intentKey: string;
  onIntent: (id: string) => void;
  onProgress: (sent: number) => void;
  onFinalizing: () => void;
};
export const isUploadPending = (state: UploadState) =>
  ['queued', 'uploading', 'finalizing'].includes(state);

/** Per-mounted-Studio controller. Files and credentials are never persisted or shared between users. */
export class UploadQueue {
  private items: UploadItem[] = [];
  private tasks = new Map<string, Task>();
  private active = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private identity: string | null = null;
  private generation = 0;
  constructor(
    private transfer: (attempt: UploadAttempt) => Promise<void>,
    private committed: (target: UploadTarget) => Promise<void>,
    private options = { concurrency: 2, completedMs: 1600, exitMs: 220, maxItems: 100 },
  ) {}
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    for (const listener of this.listeners) listener();
  }
  private update(id: string, values: Partial<UploadItem>) {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...values } : item));
    this.publish();
  }
  setIdentity(identity: string | null) {
    if (identity === this.identity) return;
    this.clear();
    this.identity = identity;
  }
  clear() {
    this.generation++;
    for (const task of this.tasks.values()) task.controller?.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.tasks.clear();
    this.active.clear();
    this.items = [];
    this.publish();
  }
  enqueue(files: File[], target: UploadTarget) {
    if (!this.identity) throw new Error('Sign in again before uploading files.');
    if (files.length + this.items.length > this.options.maxItems)
      throw new Error(
        `The queue holds up to ${this.options.maxItems} files. Wait for uploads to finish, then add more.`,
      );
    const additions = files.map((file) => {
      const id = crypto.randomUUID();
      this.tasks.set(id, { file, intentKey: crypto.randomUUID() });
      return {
        id,
        name: file.name,
        size: file.size,
        target: { ...target },
        state: 'queued' as const,
        sent: 0,
        speed: 0,
        leaving: false,
      };
    });
    this.items = [...this.items, ...additions];
    this.publish();
    this.pump();
    return additions.map((item) => item.id);
  }
  cancel(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item || !isUploadPending(item.state)) return;
    this.tasks.get(id)?.controller?.abort();
    this.tasks.delete(id);
    this.update(id, { state: 'canceled', speed: 0 });
    this.autoDismiss(id);
    this.pump();
  }
  retry(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item || item.state !== 'failed' || !this.tasks.get(id)?.file) return;
    this.update(id, { state: 'queued', sent: 0, speed: 0, error: undefined, leaving: false });
    this.pump();
  }
  dismiss(id: string) {
    const item = this.items.find((item) => item.id === id);
    if (!item || isUploadPending(item.state) || item.leaving) return;
    clearTimeout(this.timers.get(id));
    this.tasks.delete(id);
    this.update(id, { leaving: true });
    this.timers.set(
      id,
      setTimeout(() => {
        this.items = this.items.filter((item) => item.id !== id);
        this.timers.delete(id);
        this.publish();
      }, this.options.exitMs),
    );
  }
  private autoDismiss(id: string) {
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.dismiss(id);
      }, this.options.completedMs),
    );
  }
  private pump() {
    for (const item of this.items) {
      if (this.active.size >= this.options.concurrency) break;
      if (item.state !== 'queued' || this.active.has(item.id)) continue;
      const task = this.tasks.get(item.id);
      if (task?.file) void this.start(item, task, task.file);
    }
  }
  private async start(item: UploadItem, task: Task, file: File) {
    const generation = this.generation;
    const controller = new AbortController();
    task.controller = controller;
    this.active.add(item.id);
    this.update(item.id, { state: 'uploading' });
    const began = performance.now();
    const valid = () =>
      generation === this.generation &&
      !controller.signal.aborted &&
      this.tasks.get(item.id) === task &&
      task.controller === controller &&
      this.active.has(item.id);
    try {
      await this.transfer({
        file,
        target: item.target,
        signal: controller.signal,
        objectId: task.objectId,
        intentKey: task.intentKey,
        onIntent: (id) => {
          if (valid()) task.objectId = id;
        },
        onProgress: (sent) => {
          if (valid()) {
            const loaded = Math.min(file.size, Math.max(0, Number.isFinite(sent) ? sent : 0));
            const previous = this.items.find((row) => row.id === item.id)?.sent ?? 0;
            this.update(item.id, {
              sent: Math.max(previous, loaded),
              speed: loaded / Math.max(0.1, (performance.now() - began) / 1000),
            });
          }
        },
        onFinalizing: () => {
          if (valid()) this.update(item.id, { state: 'finalizing', sent: file.size });
        },
      });
      if (!valid()) return;
      // Completion means the API acknowledged storage finalization, not merely 100% browser bytes.
      this.tasks.delete(item.id);
      this.update(item.id, { state: 'completed', sent: file.size, speed: 0 });
      this.autoDismiss(item.id);
      this.active.delete(item.id);
      this.pump();
      // A failed refresh must not retry a successfully committed upload.
      await this.committed(item.target).catch(() => {});
    } catch (error) {
      if (valid())
        this.update(item.id, {
          state: 'failed',
          speed: 0,
          error: error instanceof Error ? error.message : 'Upload failed. Try again.',
        });
    } finally {
      if (generation === this.generation) {
        this.active.delete(item.id);
        this.pump();
      }
    }
  }
}
