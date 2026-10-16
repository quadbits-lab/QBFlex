import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  File,
  LoaderCircle,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { ShadcnButton as Button, cn } from '@qb-flex/ui';
import {
  UploadQueue,
  UPLOAD_VISIBLE_LIMIT,
  isUploadPending,
  type UploadItem,
} from './upload-queue';
import { transferQueuedUpload } from './upload-transfer';
import { refreshStudioQueries } from './query-client';
import type { PlatformSession } from './session';

const Context = createContext<UploadQueue | null>(null);
export function useUploadQueue() {
  const queue = useContext(Context);
  if (!queue) throw new Error('Upload queue requires its Studio provider.');
  return queue;
}
export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const [queue] = useState(
    () => new UploadQueue(transferQueuedUpload, () => refreshStudioQueries(cache)),
  );
  useEffect(() => {
    const sync = () => {
      const state = cache.getQueryState<PlatformSession | null>(['platform-session']);
      queue.setIdentity(state?.status === 'success' ? (state.data?.user.id ?? null) : null);
    };
    sync();
    const unsubscribe = cache.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === 'platform-session') sync();
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.getSnapshot().some((item) => isUploadPending(item.state))) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', beforeUnload);
      queue.clear();
    };
  }, [cache, queue]);
  return (
    <Context.Provider value={queue}>
      {children}
      <UploadQueuePanel />
    </Context.Provider>
  );
}

export function uploadSize(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const labels: Record<UploadItem['state'], string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  finalizing: 'Saving to storage',
  completed: 'Uploaded',
  failed: 'Upload failed',
  canceled: 'Canceled',
};
function QueueRow({ item, index, queue }: { item: UploadItem; index: number; queue: UploadQueue }) {
  const percent = item.size
    ? Math.round((item.sent / item.size) * 100)
    : item.state === 'completed'
      ? 100
      : 0;
  const active = item.state === 'uploading' || item.state === 'finalizing';
  const pending = isUploadPending(item.state);
  const eta =
    item.speed > 0 && item.sent < item.size ? Math.ceil((item.size - item.sent) / item.speed) : 0;
  return (
    <li
      className="upload-queue-row"
      data-leaving={item.leaving}
      data-state={item.state}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex gap-3 border-b border-border/70 px-4 py-3.5">
          <div
            className={cn(
              'relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border bg-muted/50',
              item.state === 'completed' &&
                'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              item.state === 'failed' && 'border-destructive/20 bg-destructive/10 text-destructive',
            )}
            aria-hidden="true"
          >
            {item.state === 'completed' ? (
              <Check size={17} />
            ) : item.state === 'failed' ? (
              <CircleAlert size={17} />
            ) : active ? (
              <ArrowUpRight size={17} />
            ) : (
              <File size={17} />
            )}
            {active && (
              <span className="upload-queue-orbit absolute -inset-px rounded-xl border border-primary/50" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="m-0 flex-1 truncate text-xs font-medium" title={item.name}>
                {item.name}
              </p>
              {item.state === 'failed' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={`Retry ${item.name}`}
                  onClick={() => queue.retry(item.id)}
                >
                  <RotateCcw size={12} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                aria-label={`${pending ? 'Cancel' : 'Dismiss'} ${item.name}`}
                onClick={() => (pending ? queue.cancel(item.id) : queue.dismiss(item.id))}
              >
                <X size={13} />
              </Button>
            </div>
            <p
              className="m-0 truncate text-[10px] text-muted-foreground"
              title={`${item.target.projectName} / ${item.target.branchName} / ${item.target.bucketName}`}
            >
              {item.target.bucketName} <span aria-hidden="true">·</span> {uploadSize(item.size)}{' '}
              <span aria-hidden="true">·</span> {item.target.projectName}/{item.target.branchName}
            </p>
            <div
              className="relative mt-2 h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`Upload progress for ${item.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${labels[item.state]}: ${percent}%`}
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none',
                  item.state === 'completed' && 'bg-emerald-500',
                  item.state === 'failed' && 'bg-destructive',
                )}
                style={{ width: `${percent}%` }}
              >
                {active && <span className="upload-queue-shimmer absolute inset-0" />}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
              <span
                className={cn(
                  item.state === 'failed' && 'text-destructive',
                  item.state === 'completed' && 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {labels[item.state]}
                {item.state === 'uploading' ? ` · ${percent}%` : ''}
              </span>
              <span>
                {item.state === 'uploading'
                  ? `${uploadSize(item.sent)} / ${uploadSize(item.size)}`
                  : item.state === 'queued'
                    ? 'In queue'
                    : ''}
              </span>
            </div>
            {item.state === 'uploading' && item.speed > 0 && (
              <p className="mt-0.5 mb-0 text-[10px] text-muted-foreground">
                {uploadSize(item.speed)}/s
                {eta ? ` · about ${eta < 60 ? `${eta}s` : `${Math.ceil(eta / 60)}m`} left` : ''}
              </p>
            )}
            {item.error && (
              <p className="mt-1 mb-0 break-words text-[10px] leading-relaxed text-destructive">
                {item.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
export function UploadQueuePanel() {
  const queue = useUploadQueue();
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const active = items.filter(
    (item) => item.state === 'uploading' || item.state === 'finalizing',
  ).length;
  const waiting = items.filter((item) => item.state === 'queued').length;
  const failed = items.filter((item) => item.state === 'failed').length;
  if (!items.length) return null;
  const visible = items.slice(0, UPLOAD_VISIBLE_LIMIT);
  return (
    <section
      aria-label="Upload queue"
      className="upload-queue-panel fixed right-4 bottom-4 z-40 w-[calc(100vw-2rem)] max-w-[390px] overflow-hidden rounded-2xl border border-border bg-card/95 text-card-foreground shadow-[0_12px_48px_-12px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:right-6 sm:bottom-6"
    >
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          {active ? (
            <LoaderCircle
              size={15}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Upload size={15} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-xs font-semibold">
            Uploads{' '}
            <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {items.length}
            </span>
          </h2>
          <p
            className="mt-0.5 mb-0 text-[10px] text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {active || waiting
              ? `${active} active · ${waiting} waiting`
              : failed
                ? `${failed} ${failed === 1 ? 'file needs' : 'files need'} attention`
                : 'All uploads finished'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} upload queue`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </Button>
      </header>
      {!collapsed && (
        <>
          <ol className="m-0 max-h-[min(60svh,32rem)] list-none overflow-y-auto border-t border-border p-0">
            {visible.map((item, index) => (
              <QueueRow key={item.id} item={item} index={index} queue={queue} />
            ))}
          </ol>
          <footer className="px-4 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
            {items.length > UPLOAD_VISIBLE_LIMIT
              ? `${items.length - UPLOAD_VISIBLE_LIMIT} more in queue · `
              : ''}
            Keep this tab open while files upload.
          </footer>
        </>
      )}
    </section>
  );
}
