import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  CardFooter,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Loading,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  ShadcnButton,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  notifyError,
} from '@qb-flex/ui';
import { management } from '../api';
import { useWrite } from './shared';

type StorageBucket = {
  id: string;
  name: string;
  visibility: 'private' | 'public' | string;
  max_size: number | string;
};

type StorageObject = {
  id: string;
  bucket_id: string;
  key: string;
  owner_id: string;
  size: number | string;
  mime: string;
  state: string;
  created_at?: string;
};

type SortKey = 'name' | 'date' | 'size';
type SortDir = 'asc' | 'desc';

const PAGE_SIZES = [10, 25, 50] as const;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 10 || unit === 0 ? 1 : 2)} ${units[unit]}`;
}

function formatShortDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatLongDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fileName(key: string) {
  const parts = key.split('/').filter(Boolean);
  return parts.at(-1) || key || 'Untitled';
}

function ownerInitial(ownerId: string) {
  const ch = ownerId.trim().charAt(0);
  return ch ? ch.toUpperCase() : 'U';
}

function fileKind(object: StorageObject) {
  const key = object.key.toLowerCase();
  const mime = (object.mime || '').toLowerCase();
  if (key.endsWith('/') || mime === 'inode/directory') return 'folder' as const;
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/.test(key))
    return 'image' as const;
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/.test(key)) return 'video' as const;
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/.test(key)) return 'audio' as const;
  if (mime === 'application/pdf' || key.endsWith('.pdf')) return 'pdf' as const;
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    /\.(xlsx?|csv|tsv)$/.test(key)
  )
    return 'sheet' as const;
  if (
    mime.includes('zip') ||
    mime.includes('compressed') ||
    /\.(zip|rar|7z|tar|gz)$/.test(key)
  )
    return 'archive' as const;
  if (
    mime.startsWith('text/') ||
    mime.includes('javascript') ||
    mime.includes('json') ||
    /\.(tsx?|jsx?|css|html?|md|json|yml|yaml|toml)$/.test(key)
  )
    return 'code' as const;
  if (mime.includes('word') || /\.(docx?|rtf)$/.test(key)) return 'doc' as const;
  return 'file' as const;
}

const KIND_STYLES: Record<
  ReturnType<typeof fileKind>,
  { className: string; Icon: typeof File }
> = {
  folder: { className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', Icon: Folder },
  image: { className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', Icon: FileImage },
  video: { className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', Icon: FileVideo },
  audio: { className: 'bg-pink-500/15 text-pink-600 dark:text-pink-400', Icon: FileAudio },
  pdf: { className: 'bg-red-500/15 text-red-600 dark:text-red-400', Icon: FileText },
  sheet: {
    className: 'bg-green-600/15 text-green-700 dark:text-green-400',
    Icon: FileSpreadsheet,
  },
  archive: { className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', Icon: FileArchive },
  code: { className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', Icon: FileCode },
  doc: { className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400', Icon: FileText },
  file: { className: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400', Icon: File },
};

function FileTypeIcon({
  object,
  size = 'md',
}: {
  object: StorageObject;
  size?: 'md' | 'lg';
}) {
  const kind = fileKind(object);
  const { className, Icon } = KIND_STYLES[kind];
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-lg',
        size === 'lg' ? 'size-14 rounded-xl' : 'size-9',
        className,
      )}
      aria-hidden="true"
    >
      <Icon className={size === 'lg' ? 'size-7' : 'size-4.5'} />
    </span>
  );
}

function OwnerAvatar({ ownerId }: { ownerId: string }) {
  return (
    <span
      className="inline-grid size-7 place-items-center rounded-full bg-muted text-[0.65rem] font-semibold text-muted-foreground ring-1 ring-border"
      title={ownerId}
      aria-label={`Owner ${ownerId}`}
    >
      {ownerInitial(ownerId)}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />;
  return active && dir === 'asc' ? (
    <ArrowUp className="size-3.5" aria-hidden="true" />
  ) : (
    <ArrowDown className="size-3.5" aria-hidden="true" />
  );
}

export function StorageWorkspace({ base }: { base: string }) {
  const buckets = useQuery({
    queryKey: ['buckets', base],
    queryFn: () => management.request<StorageBucket[]>(base + '/buckets'),
  });
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [size, setSize] = useState('10485760');
  const [mime, setMime] = useState('');
  const [selected, setSelected] = useState('');
  const write = useWrite();
  const rows = buckets.data?.data ?? [];

  useEffect(() => {
    if (!rows.length) {
      setSelected('');
      return;
    }
    if (!selected || !rows.some((bucket) => bucket.id === selected)) {
      setSelected(rows[0]!.id);
    }
  }, [rows, selected]);

  const activeBucket = rows.find((bucket) => bucket.id === selected) ?? null;

  return (
    <div className="grid grid-cols-1 content-start gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1 sm:max-w-xs">
          <Select
            value={selected || undefined}
            onValueChange={setSelected}
            disabled={!rows.length}
          >
            <SelectTrigger aria-label="Storage bucket">
              <SelectValue placeholder={buckets.isPending ? 'Loading buckets…' : 'Select bucket'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {rows.map((bucket) => (
                  <SelectItem key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {activeBucket ? (
          <Badge variant={activeBucket.visibility === 'public' ? 'warning' : 'outline'}>
            {activeBucket.visibility}
          </Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ShadcnButton variant="outline" onClick={() => setDialog(true)}>
            <Plus data-icon="inline-start" />
            New bucket
          </ShadcnButton>
        </div>
      </div>

      {buckets.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <Empty title="No buckets yet">
            Create a bucket, then upload files through Studio or an authenticated application
            client.
          </Empty>
          <div className="mt-4 flex justify-center">
            <ShadcnButton onClick={() => setDialog(true)}>
              <Plus data-icon="inline-start" />
              New bucket
            </ShadcnButton>
          </div>
        </div>
      ) : activeBucket ? (
        <ObjectBrowser base={base} bucket={activeBucket} />
      ) : null}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogTitle>Create a bucket</DialogTitle>
          <DialogDescription>Buckets are branch-scoped and policy-protected.</DialogDescription>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bucket-name">Name</FieldLabel>
              <Input
                id="bucket-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="attachments"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bucket-visibility">Visibility</FieldLabel>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger id="bucket-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="private">private</SelectItem>
                    <SelectItem value="public">public</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="bucket-max-size">Maximum file size in bytes</FieldLabel>
              <Input
                id="bucket-max-size"
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bucket-mime">Allowed MIME types (comma separated)</FieldLabel>
              <Input
                id="bucket-mime"
                value={mime}
                onChange={(e) => setMime(e.target.value)}
                placeholder="image/png, image/jpeg"
              />
            </Field>
          </FieldGroup>
          <CardFooter className="px-0">
            <Button
              disabled={write.isPending || !name}
              onClick={async () => {
                const created = await write.mutateAsync({
                  path: base + '/buckets',
                  body: {
                    name,
                    visibility,
                    maxSize: Number(size),
                    mimeRules: mime
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                });
                toast.success('Bucket "' + name + '" created');
                setDialog(false);
                setName('');
                if (created?.data?.id) setSelected(created.data.id);
              }}
            >
              {write.isPending && <Spinner data-icon="inline-start" />}
              Create bucket
            </Button>
          </CardFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ObjectBrowser({ base, bucket }: { base: string; bucket: StorageBucket }) {
  const cache = useQueryClient();
  const objects = useQuery({
    queryKey: ['objects', base, bucket.id],
    queryFn: () => management.request<StorageObject[]>(base + '/buckets/' + bucket.id + '/objects'),
  });
  const uploadInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState<StorageObject | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const rows = objects.data?.data ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = needle
      ? rows.filter((row) => row.key.toLowerCase().includes(needle) || row.mime.toLowerCase().includes(needle))
      : [...rows];
    next.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.key.localeCompare(b.key);
      else if (sortKey === 'size') cmp = Number(a.size) - Number(b.size);
      else cmp = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [rows, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const end = filtered.length ? Math.min(start + pageRows.length, filtered.length) : 0;
  const active = rows.find((row) => row.id === activeId) ?? null;
  const pageIds = pageRows.map((row) => row.id);
  const allPageChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
  const somePageChecked = pageIds.some((id) => checked.has(id));

  useEffect(() => {
    setPage(1);
    setChecked(new Set());
    setActiveId(null);
    setQuery('');
  }, [bucket.id]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize, sortKey, sortDir]);

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(next);
    setSortDir(next === 'date' ? 'desc' : 'asc');
  }

  async function downloadObject(object: StorageObject) {
    try {
      const blob = (await management.transfer(
        base + '/objects/' + object.id + '/content',
      )) as Blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName(object.key);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      notifyError(downloadError, 'Download failed');
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search for files and folders"
            className="h-10 border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for files and folders..."
            value={query}
          />
        </div>
        <ShadcnButton disabled={pending} onClick={() => uploadInput.current?.click()}>
          <Upload data-icon="inline-start" />
          {pending ? 'Uploading…' : 'Upload'}
        </ShadcnButton>
        <input
          ref={uploadInput}
          aria-label="Choose file to upload"
          type="file"
          className="sr-only"
          disabled={pending}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPending(true);
            try {
              const intent = await management.request(
                base + '/buckets/' + bucket.id + '/objects',
                'POST',
                {
                  key: file.name,
                  size: file.size,
                  mime: file.type || 'application/octet-stream',
                },
              );
              await management.transfer(
                base + '/objects/' + intent.data.id + '/content',
                'PUT',
                file,
              );
              await cache.invalidateQueries({ queryKey: ['objects', base, bucket.id] });
              toast.success(file.name + ' uploaded');
            } catch (uploadError) {
              notifyError(uploadError, 'Upload failed');
            } finally {
              setPending(false);
              if (uploadInput.current) uploadInput.current.value = '';
            }
          }}
        />
      </div>

      <div className="flex min-h-[28rem] flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          {objects.isPending ? (
            <div className="grid flex-1 place-items-center p-10">
              <Loading />
            </div>
          ) : !rows.length ? (
            <div className="grid flex-1 place-items-center p-10">
              <Empty title="No objects in this bucket">
                Upload a file to start browsing objects in {bucket.name}.
              </Empty>
            </div>
          ) : !filtered.length ? (
            <div className="grid flex-1 place-items-center p-10">
              <Empty title="No matches">Nothing matched “{query.trim()}”.</Empty>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 px-4">
                      <Checkbox
                        aria-label="Select all on page"
                        checked={
                          allPageChecked ? true : somePageChecked ? 'indeterminate' : false
                        }
                        onCheckedChange={(value) => {
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (value) pageIds.forEach((id) => next.add(id));
                            else pageIds.forEach((id) => next.delete(id));
                            return next;
                          });
                        }}
                      />
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5"
                        onClick={() => toggleSort('name')}
                      >
                        Name
                        <SortIcon active={sortKey === 'name'} dir={sortDir} />
                      </button>
                    </TableHead>
                    <TableHead className="w-36">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5"
                        onClick={() => toggleSort('date')}
                      >
                        Date
                        <SortIcon active={sortKey === 'date'} dir={sortDir} />
                      </button>
                    </TableHead>
                    <TableHead className="w-28">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5"
                        onClick={() => toggleSort('size')}
                      >
                        Size
                        <SortIcon active={sortKey === 'size'} dir={sortDir} />
                      </button>
                    </TableHead>
                    <TableHead className="w-20">Owner</TableHead>
                    <TableHead className="w-12 px-2 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((object) => {
                    const selectedRow = activeId === object.id;
                    return (
                      <TableRow
                        key={object.id}
                        data-state={selectedRow ? 'selected' : undefined}
                        className="cursor-pointer"
                        onClick={() => setActiveId(object.id)}
                      >
                        <TableCell className="px-4" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label={'Select ' + object.key}
                            checked={checked.has(object.id)}
                            onCheckedChange={(value) => {
                              setChecked((prev) => {
                                const next = new Set(prev);
                                if (value) next.add(object.id);
                                else next.delete(object.id);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-3">
                            <FileTypeIcon object={object} />
                            <span className="truncate font-medium text-foreground">
                              {fileName(object.key)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatShortDate(object.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatBytes(Number(object.size))}
                        </TableCell>
                        <TableCell>
                          <OwnerAvatar ownerId={object.owner_id} />
                        </TableCell>
                        <TableCell className="px-2 text-right" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <ShadcnButton
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={'Actions for ' + object.key}
                              >
                                <MoreHorizontal />
                              </ShadcnButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setActiveId(object.id)}>
                                View details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => downloadObject(object)}>
                                <Download />
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setRemove(object)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) =>
                      setPageSize(Number(value) as (typeof PAGE_SIZES)[number])
                    }
                  >
                    <SelectTrigger className="h-8 w-[4.5rem]" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PAGE_SIZES.map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    {filtered.length ? `${start + 1} - ${end} of ${filtered.length}` : '0 of 0'}
                  </span>
                  <div className="flex items-center gap-1">
                    <ShadcnButton
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Previous page"
                      disabled={safePage <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      <ChevronLeft />
                    </ShadcnButton>
                    <span className="grid min-w-8 place-items-center rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground">
                      {safePage}
                    </span>
                    <ShadcnButton
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Next page"
                      disabled={safePage >= pageCount}
                      onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                    >
                      <ChevronRight />
                    </ShadcnButton>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {active ? (
          <aside className="w-full shrink-0 border-t border-border bg-card lg:w-80 lg:border-t-0 lg:border-l">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
              <div className="min-w-0">
                <FileTypeIcon object={active} size="lg" />
                <p className="mt-3 mb-0 truncate text-sm font-semibold text-foreground">
                  {fileName(active.key)}
                </p>
                <p className="m-0 truncate font-mono text-2xs text-muted-foreground">{active.key}</p>
              </div>
              <ShadcnButton
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Close details"
                onClick={() => setActiveId(null)}
              >
                <X />
              </ShadcnButton>
            </div>

            <div className="space-y-5 px-4 py-4">
              <section className="space-y-3">
                <h3 className="m-0 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Info
                </h3>
                <dl className="m-0 grid grid-cols-1 gap-2.5 text-sm">
                  <DetailRow label="Type" value={fileKind(active) === 'folder' ? 'Folder' : 'File'} />
                  <DetailRow label="Size" value={formatBytes(Number(active.size))} />
                  <DetailRow label="Owner" value={active.owner_id} mono />
                  <DetailRow label="Location" value={bucket.name} />
                  <DetailRow label="MIME" value={active.mime || '—'} mono />
                  <DetailRow label="Modified" value={formatLongDate(active.created_at)} />
                  <DetailRow label="Created" value={formatLongDate(active.created_at)} />
                </dl>
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="m-0 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Settings
                </h3>
                <div className="space-y-3">
                  <SettingRow
                    label="File Sharing"
                    checked={bucket.visibility === 'public'}
                    hint="Bucket visibility is set when the bucket is created."
                  />
                  <SettingRow
                    label="Backup"
                    checked={false}
                    hint="Object-level backup controls are planned."
                  />
                  <SettingRow
                    label="Sync"
                    checked={false}
                    hint="Object sync controls are planned."
                  />
                </div>
              </section>

              <div className="flex flex-wrap gap-2 pt-1">
                <ShadcnButton variant="outline" size="sm" onClick={() => downloadObject(active)}>
                  <Download data-icon="inline-start" />
                  Download
                </ShadcnButton>
                <ShadcnButton
                  variant="destructive"
                  size="sm"
                  onClick={() => setRemove(active)}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete
                </ShadcnButton>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={!!remove} onOpenChange={(open) => !open && setRemove(null)}>
        <DialogContent>
          <DialogTitle>Delete object</DialogTitle>
          <DialogDescription>
            Delete <span className="font-mono">{remove?.key}</span> from this branch? This cannot be
            undone.
          </DialogDescription>
          <CardFooter className="px-0">
            <Button
              variant="danger"
              disabled={pending}
              onClick={async () => {
                if (!remove) return;
                try {
                  setPending(true);
                  await management.request(base + '/objects/' + remove.id, 'DELETE');
                  toast.success('Object deleted');
                  if (activeId === remove.id) setActiveId(null);
                  setChecked((prev) => {
                    const next = new Set(prev);
                    next.delete(remove.id);
                    return next;
                  });
                  setRemove(null);
                  await cache.invalidateQueries({ queryKey: ['objects', base, bucket.id] });
                } catch (deleteError) {
                  notifyError(deleteError, 'Delete failed');
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending && <Spinner data-icon="inline-start" />}
              Delete object
            </Button>
          </CardFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
      <dt className="m-0 text-muted-foreground">{label}</dt>
      <dd className={cn('m-0 min-w-0 truncate text-foreground', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}

function SettingRow({
  label,
  checked,
  hint,
}: {
  label: string;
  checked: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-sm text-foreground">{label}</p>
        <p className="m-0 text-2xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} disabled aria-label={label} />
    </div>
  );
}
