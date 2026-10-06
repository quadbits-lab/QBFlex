import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Search } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  Input,
  Loading,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShadcnButton as Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@qb-flex/ui';
import { ErrorMessage } from './shared';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  BarXAxis,
  ChartStatFlow,
  ChartTooltip,
  Grid,
  Legend,
  LegendItem,
  LegendLabel,
  LegendMarker,
  LegendValue,
  PieCenter,
  PieChart,
  PieSlice,
  XAxis,
} from '@qb-flex/ui/charts';
import {
  type AuditEvent,
  activitySeries,
  activitySummary,
  countBy,
} from './activity-metrics';

const RESULT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

function isFailure(result: string) {
  const value = String(result).toLowerCase();
  return value.includes('fail') || value === 'error';
}

function resultBadgeVariant(result: string) {
  return isFailure(result) ? ('warning' as const) : ('success' as const);
}

function ActivityKpis({
  events,
  pending,
}: {
  events: AuditEvent[];
  pending: boolean;
}) {
  const summary = activitySummary(events);
  const items = [
    { label: 'Total events', value: summary.total },
    { label: 'Last 24 hours', value: summary.last24h },
    { label: 'Failures', value: summary.failures },
    { label: 'Success rate', value: summary.successRate, suffix: '%' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="pt-5">
            {pending ? (
              <Skeleton className="h-12 w-24" />
            ) : (
              <div className="flex flex-col">
                <ChartStatFlow
                  label={item.label}
                  suffix={item.suffix}
                  value={item.value}
                  valueClassName="text-3xl font-semibold tracking-tight tabular-nums"
                  labelClassName="text-xs text-muted-foreground"
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActivityTrendChart({
  events,
  pending,
  days = 14,
  aspectRatio = '2.4 / 1',
}: {
  events: AuditEvent[];
  pending: boolean;
  days?: number;
  aspectRatio?: string;
}) {
  const series = useMemo(() => activitySeries(events, days), [events, days]);
  const legendItems = useMemo(() => {
    let success = 0;
    let failure = 0;
    for (const point of series) {
      success += point.success;
      failure += point.failure;
    }
    return [
      { label: 'Success', color: 'var(--chart-line-primary)', value: success },
      { label: 'Failure', color: 'var(--chart-line-secondary)', value: failure },
    ];
  }, [series]);
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Activity trend</CardTitle>
          <CardDescription>Audit events over the last {days} days.</CardDescription>
        </div>
        <Legend className="flex flex-wrap gap-3" items={legendItems}>
          <LegendItem className="flex items-center gap-2 text-xs text-muted-foreground">
            <LegendMarker className="size-2.5 rounded-full" />
            <LegendLabel />
            <LegendValue className="tabular-nums" />
          </LegendItem>
        </Legend>
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="aspect-[2.4/1] w-full rounded-md" />
        ) : (
          <AreaChart
            aspectRatio={aspectRatio}
            className="w-full"
            data={series}
            margin={{ top: 12, right: 12, bottom: 28, left: 8 }}
            status="ready"
          >
            <Grid horizontal />
            <Area
              dataKey="success"
              fadeEdges
              fill="var(--chart-line-primary)"
              fillOpacity={0.28}
              strokeWidth={2}
            />
            <Area
              dataKey="failure"
              fadeEdges
              fill="var(--chart-line-secondary)"
              fillOpacity={0.2}
              strokeWidth={1.5}
            />
            <XAxis />
            <ChartTooltip
              rows={(point) => [
                {
                  label: 'Success',
                  value: Number(point.success ?? 0),
                  color: 'var(--chart-line-primary)',
                },
                {
                  label: 'Failure',
                  value: Number(point.failure ?? 0),
                  color: 'var(--chart-line-secondary)',
                },
              ]}
            />
          </AreaChart>
        )}
      </CardContent>
    </Card>
  );
}

function ActionBarChart({ events, pending }: { events: AuditEvent[]; pending: boolean }) {
  const data = useMemo(() => countBy(events, 'action', 6), [events]);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Top actions</CardTitle>
        <CardDescription>Most frequent audit actions in this project.</CardDescription>
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="aspect-[1.6/1] w-full rounded-md" />
        ) : !data.length ? (
          <Empty title="No actions recorded yet" />
        ) : (
          <BarChart
            aspectRatio="1.6 / 1"
            barGap={0.28}
            className="w-full"
            data={data}
            margin={{ top: 8, right: 8, bottom: 36, left: 8 }}
            xDataKey="name"
          >
            <Grid horizontal />
            <Bar dataKey="value" fill="var(--chart-line-primary)" lineCap="round" />
            <BarXAxis maxLabels={6} />
            <ChartTooltip />
          </BarChart>
        )}
      </CardContent>
    </Card>
  );
}

function ResultPieChart({ events, pending }: { events: AuditEvent[]; pending: boolean }) {
  const data = useMemo(() => {
    return countBy(events, 'result', 5).map((item, index) => ({
      label: item.label,
      value: item.value,
      color: RESULT_COLORS[index % RESULT_COLORS.length],
    }));
  }, [events]);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Result mix</CardTitle>
        <CardDescription>Outcomes across recorded audit events.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {pending ? (
          <Skeleton className="size-48 rounded-full" />
        ) : !data.length ? (
          <Empty title="No results to chart yet" />
        ) : (
          <>
            <PieChart className="mx-auto w-full max-w-56" data={data} innerRadius={58} size={220}>
              {data.map((_, index) => (
                <PieSlice key={data[index]!.label} index={index} />
              ))}
              <PieCenter defaultLabel="Events" />
            </PieChart>
            <Legend
              className="grid w-full gap-2"
              items={data.map((item) => ({
                label: item.label,
                color: item.color,
                value: item.value,
              }))}
            >
              <LegendItem className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <LegendMarker className="size-2.5 shrink-0 rounded-full" />
                  <LegendLabel className="truncate" />
                </span>
                <LegendValue className="tabular-nums text-muted-foreground" />
              </LegendItem>
            </Legend>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityTable({
  events,
  pending,
  error,
  compact,
}: {
  events: AuditEvent[];
  pending: boolean;
  error: Error | null;
  compact: boolean;
}) {
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const results = useMemo(() => {
    const unique = new Set(events.map((event) => String(event.result || 'unknown')));
    return [...unique].sort();
  }, [events]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (resultFilter !== 'all' && String(event.result) !== resultFilter) return false;
      if (!needle) return true;
      return [event.action, event.resource, event.result]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [events, query, resultFilter]);
  const rows = filtered.slice(0, compact ? 6 : 200);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{compact ? 'Recent activity' : 'Audit events'}</CardTitle>
          <CardDescription>
            {compact
              ? 'Latest recorded changes across this project.'
              : 'Search and filter platform activity for the selected project.'}
          </CardDescription>
        </div>
        <Badge variant="outline">
          {pending ? '…' : `${rows.length}${filtered.length > rows.length ? '+' : ''} events`}
        </Badge>
      </CardHeader>
      {!compact ? (
        <CardContent className="flex flex-wrap gap-2 border-b pb-4">
          <div className="relative min-w-48 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search audit events"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search action, resource, result…"
              value={query}
            />
          </div>
          <Select onValueChange={setResultFilter} value={resultFilter}>
            <SelectTrigger aria-label="Filter by result" className="w-40">
              <SelectValue placeholder="Result" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All results</SelectItem>
                {results.map((result) => (
                  <SelectItem key={result} value={result}>
                    {result}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardContent>
      ) : null}
      <CardContent className={compact ? undefined : 'pt-4'}>
        {pending ? (
          <Loading />
        ) : error ? (
          <ErrorMessage error={error} />
        ) : !rows.length ? (
          <Empty title={events.length ? 'No matching events' : 'No recorded events yet'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.action}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs">
                    {row.resource}
                  </TableCell>
                  <TableCell>
                    <Badge variant={resultBadgeVariant(row.result)}>{row.result}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(row.time).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {compact ? (
        <CardFooter>
          <Button asChild size="sm" variant="outline">
            <Link to="/logs">
              Open activity
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function ActivityDashboard({
  events,
  pending,
  error,
  compact = false,
}: {
  events: AuditEvent[];
  pending: boolean;
  error: Error | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ActivityTrendChart aspectRatio="2.2 / 1" days={14} events={events} pending={pending} />
        <ActivityTable compact error={error} events={events} pending={pending} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ActivityKpis events={events} pending={pending} />
      <ActivityTrendChart days={21} events={events} pending={pending} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ActionBarChart events={events} pending={pending} />
        <ResultPieChart events={events} pending={pending} />
      </div>
      <ActivityTable compact={false} error={error} events={events} pending={pending} />
    </div>
  );
}
