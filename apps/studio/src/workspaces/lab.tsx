import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Empty,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@qb-flex/ui';
import { management } from '../api';
import {
  LAB_MAX_FILE_BYTES,
  LAB_MAX_RESULT_BYTES,
  LAB_QUERY_TIMEOUT_MS,
  capDisplay,
  draftCreateTable,
  filterLabRows,
  parseLabFile,
  type LabFilterOp,
  type LabTable,
} from './lab-table';

type LabStatus = 'idle' | 'loading' | 'ready' | 'running' | 'cancelled' | 'failed';

export function LabWorkspace({ projectId, branchId }: { projectId: string; branchId: string }) {
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<LabStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [table, setTable] = useState<LabTable | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [matched, setMatched] = useState<number | null>(null);
  const [column, setColumn] = useState('');
  const [op, setOp] = useState<LabFilterOp>('contains');
  const [value, setValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const replaceSession = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  const loadFile = async (file: File | undefined) => {
    if (!file || !consent) return;
    const controller = replaceSession();
    setStatus('loading');
    setMessage(null);
    setMatched(null);
    try {
      const parsed = await parseLabFile(file, controller.signal);
      if (abortRef.current !== controller) return;
      const display = capDisplay(parsed.rows.slice(0, parsed.rows.length));
      setTable(parsed);
      setPreview(display.rows);
      setTruncated(display.truncated);
      setColumn(parsed.columns[0] ?? '');
      setStatus('ready');
    } catch (error) {
      if (abortRef.current !== controller) return;
      setTable(null);
      setPreview([]);
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  };

  const runFilter = async () => {
    if (!table || !column) return;
    const controller = replaceSession();
    const timeout = AbortSignal.timeout(LAB_QUERY_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, timeout]);
    setStatus('running');
    setMessage(null);
    try {
      const result = await filterLabRows(table, { column, op, value }, signal);
      if (abortRef.current !== controller) return;
      setPreview(result.rows);
      setTruncated(result.truncated);
      setMatched(result.matched);
      setStatus('ready');
    } catch (error) {
      if (abortRef.current !== controller) return;
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : 'Filter failed');
    }
  };

  const exportReview = useMutation({
    mutationFn: () => {
      if (!table) throw new Error('Import a file first');
      const draft = draftCreateTable(table.columns);
      return management.reviews(projectId, branchId).create(draft);
    },
    onSuccess: (result) => {
      toast.success(`Migration review ${result.data.migrationId} drafted`);
    },
  });

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Local Data Lab parses a CSV or JSON file in this browser. DuckDB-WASM and SQLite WASM
        workers are the production path for Parquet, local SQL and imported SQLite files. This
        page ships a bounded JavaScript table instead: 100 MB file, 2 MB result display and a 10
        second filter limit. Nothing is uploaded, stored, or sent to a worker. Leaving this page
        discards the table. Export posts only a CREATE TABLE draft to schema reviews, not the
        imported rows.
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          I consent to parse this file locally. It stays in memory for this visit and is not
          uploaded with the filter.
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-64 flex-1">
          <FieldLabel htmlFor="lab-file">CSV or JSON file</FieldLabel>
          <Input
            id="lab-file"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={!consent || status === 'loading'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              void loadFile(file);
              event.target.value = '';
            }}
          />
        </Field>
        <Badge variant="outline">{status}</Badge>
        <span className="text-xs text-muted-foreground">
          Budget {Math.round(LAB_MAX_FILE_BYTES / (1024 * 1024))} MB file ·{' '}
          {Math.round(LAB_MAX_RESULT_BYTES / (1024 * 1024))} MB display · {LAB_QUERY_TIMEOUT_MS / 1000}s
          filter
        </span>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {table && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runFilter();
          }}
        >
          <Field>
            <FieldLabel htmlFor="lab-column">Column</FieldLabel>
            <Select value={column} onValueChange={setColumn}>
              <SelectTrigger id="lab-column" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {table.columns.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="lab-op">Operator</FieldLabel>
            <Select value={op} onValueChange={(next) => setOp(next as LabFilterOp)}>
              <SelectTrigger id="lab-op" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">contains</SelectItem>
                <SelectItem value="eq">equals</SelectItem>
                <SelectItem value="neq">not equals</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="lab-value">Value</FieldLabel>
            <Input id="lab-value" value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={status === 'running'}>
            {status === 'running' ? 'Filtering…' : 'Run filter'}
          </Button>
          <Button
            type="button"
            disabled={exportReview.isPending}
            onClick={() => exportReview.mutate()}
          >
            {exportReview.isPending ? 'Exporting…' : 'Export as migration review'}
          </Button>
        </form>
      )}
      {exportReview.error && (
        <p role="alert" className="text-sm text-destructive">
          {exportReview.error.message}
        </p>
      )}
      {truncated && (
        <p className="m-0 text-sm text-muted-foreground">
          Display stopped at 2 MB
          {matched !== null ? ` · ${matched} rows matched before the display cap` : ''}.
        </p>
      )}
      {!table ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <Empty title="No local table">
            Consent, then choose a CSV or JSON file. The file is not sent to QB Flex.
          </Empty>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <p className="m-0 border-b border-border px-4 py-3 text-sm text-muted-foreground">
            {table.rows.length} imported rows · showing {preview.length}
            {matched !== null ? ` · ${matched} matched` : ''}
          </p>
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((name) => (
                    <TableHead key={name}>{name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row, index) => (
                  <TableRow key={index}>
                    {table.columns.map((name) => (
                      <TableCell key={name} className="max-w-64 truncate font-mono text-xs">
                        {row[name] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
