import type { ReactNode } from 'react';
import {
  Link,
  useRouter,
  type ErrorComponentProps,
  type NotFoundRouteProps,
} from '@tanstack/react-router';
import {
  ArrowLeft,
  Home,
  RefreshCw,
  ShieldAlert,
  ServerCrash,
  MapPinned,
  Unplug,
} from 'lucide-react';
import { Brand, AppFooter, ShadcnButton, cn } from '@qb-flex/ui';

export type HttpErrorCode = 400 | 404 | 500;
type StatusGraphic = HttpErrorCode | 'connection';

type ErrorCopy = {
  code: HttpErrorCode;
  title: string;
  summary: string;
  detail: string;
  hints: string[];
  Icon: typeof ShieldAlert;
  accent: string;
};

type StatusCopy = {
  badge: string;
  title: string;
  summary: string;
  detail: string;
  hints: string[];
  Icon: typeof ShieldAlert;
  accent: string;
  graphic: StatusGraphic;
};

const COPY: Record<HttpErrorCode, ErrorCopy> = {
  400: {
    code: 400,
    title: 'Bad request',
    summary: 'Studio could not understand or accept that request.',
    detail:
      'A required parameter was missing, malformed, or rejected by validation before the workspace could act on it.',
    hints: [
      'Check the URL, project, and branch selection',
      'Confirm form fields and file types before retrying',
      'Refresh and try the action again with valid input',
    ],
    Icon: ShieldAlert,
    accent: 'text-amber-600 dark:text-amber-400',
  },
  404: {
    code: 404,
    title: 'Workspace not found',
    summary: 'That route is not part of this Studio build.',
    detail:
      'The path may be mistyped, outdated after a release, or no longer available for your account.',
    hints: [
      'Return to Overview and pick a workspace page from the sidebar',
      'Use Command/Ctrl + K to jump to a known route',
      'Confirm you are signed into the correct organization',
    ],
    Icon: MapPinned,
    accent: 'text-sky-600 dark:text-sky-400',
  },
  500: {
    code: 500,
    title: 'Something broke on our side',
    summary: 'An unexpected server or client failure stopped this page.',
    detail:
      'The request reached Studio, but an unhandled error prevented a successful response. Your data is usually safe — retrying often clears a transient fault.',
    hints: [
      'Retry the page or the last action',
      'If it persists, check API health and recent deploys',
      'Share the error message below when contacting support',
    ],
    Icon: ServerCrash,
    accent: 'text-rose-600 dark:text-rose-400',
  },
};

function ErrorInfographic({ code }: { code: StatusGraphic }) {
  if (code === 'connection') {
    return (
      <svg viewBox="0 0 240 160" className="h-auto w-full max-w-[16rem]" aria-hidden="true">
        <rect
          x="36"
          y="44"
          width="72"
          height="72"
          rx="14"
          className="fill-muted stroke-border"
          strokeWidth="1.5"
        />
        <rect
          x="132"
          y="44"
          width="72"
          height="72"
          rx="14"
          className="fill-muted stroke-border"
          strokeWidth="1.5"
        />
        <path
          d="M108 80h24"
          className="stroke-rose-500/70"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="5 6"
        />
        <circle
          cx="72"
          cy="80"
          r="10"
          className="fill-rose-500/15 stroke-rose-500/70"
          strokeWidth="2"
        />
        <circle
          cx="168"
          cy="80"
          r="10"
          className="fill-sky-500/15 stroke-sky-500/60"
          strokeWidth="2"
        />
        <path
          d="M68 76l8 8M76 76l-8 8"
          className="stroke-rose-600 dark:stroke-rose-400"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (code === 400) {
    return (
      <svg viewBox="0 0 240 160" className="h-auto w-full max-w-[16rem]" aria-hidden="true">
        <rect
          x="24"
          y="28"
          width="192"
          height="104"
          rx="16"
          className="fill-muted stroke-border"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <rect x="48" y="52" width="120" height="12" rx="6" className="fill-border" />
        <rect x="48" y="74" width="84" height="10" rx="5" className="fill-border/70" />
        <rect x="48" y="96" width="64" height="10" rx="5" className="fill-border/50" />
        <circle
          cx="176"
          cy="88"
          r="28"
          className="fill-amber-500/15 stroke-amber-500/60"
          strokeWidth="2"
        />
        <path
          d="M176 72v18M176 100v2"
          className="stroke-amber-600 dark:stroke-amber-400"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (code === 404) {
    return (
      <svg viewBox="0 0 240 160" className="h-auto w-full max-w-[16rem]" aria-hidden="true">
        <path
          d="M28 118c28-36 56-36 84 0s56 36 84 0"
          className="fill-none stroke-border"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <circle
          cx="72"
          cy="78"
          r="18"
          className="fill-sky-500/10 stroke-sky-500/50"
          strokeWidth="2"
        />
        <circle cx="168" cy="62" r="10" className="fill-muted stroke-border" strokeWidth="1.5" />
        <path
          d="M72 78l34-8 28 18"
          className="fill-none stroke-sky-600 dark:stroke-sky-400"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="134" cy="88" r="4" className="fill-sky-600 dark:fill-sky-400" />
        <text
          x="168"
          y="110"
          textAnchor="middle"
          className="fill-muted-foreground text-[11px] font-semibold"
        >
          ?
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 240 160" className="h-auto w-full max-w-[16rem]" aria-hidden="true">
      <rect
        x="70"
        y="36"
        width="100"
        height="88"
        rx="12"
        className="fill-muted stroke-border"
        strokeWidth="1.5"
      />
      <rect x="86" y="52" width="68" height="8" rx="4" className="fill-border" />
      <rect x="86" y="68" width="48" height="8" rx="4" className="fill-border/70" />
      <rect x="86" y="84" width="56" height="8" rx="4" className="fill-border/50" />
      <path
        d="M118 28v16M122 120v16"
        className="stroke-border"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M40 48l28 20M200 48l-28 20M40 120l28-16M200 120l-28-16"
        className="stroke-rose-500/50"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="120"
        cy="104"
        r="10"
        className="fill-rose-500/15 stroke-rose-500/70"
        strokeWidth="2"
      />
      <path
        d="M116 100l8 8M124 100l-8 8"
        className="stroke-rose-600 dark:stroke-rose-400"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusErrorCard({
  copy,
  message,
  children,
}: {
  copy: StatusCopy;
  message?: string;
  children?: ReactNode;
}) {
  const Icon = copy.Icon;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex justify-center sm:justify-start">
        <Brand />
      </div>
      <div className="grid items-center gap-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:p-8">
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <ErrorInfographic code={copy.graphic} />
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold tracking-wider uppercase',
                copy.accent,
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {copy.badge}
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="m-0 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {copy.title}
            </h1>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">{copy.summary}</p>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">{copy.detail}</p>
          </div>
          {message ? (
            <pre className="m-0 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap">
              {message}
            </pre>
          ) : null}
          <div>
            <p className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              What you can try
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {copy.hints.map((hint) => (
                <li
                  key={hint}
                  className="flex gap-2 rounded-lg border border-border/80 bg-background/60 px-3 py-2 text-sm text-foreground"
                >
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorShell({
  code,
  message,
  children,
}: {
  code: HttpErrorCode;
  message?: string;
  children?: ReactNode;
}) {
  const page = COPY[code];
  const copy: StatusCopy = {
    badge: `HTTP ${page.code}`,
    title: page.title,
    summary: page.summary,
    detail: page.detail,
    hints: page.hints,
    Icon: page.Icon,
    accent: page.accent,
    graphic: page.code,
  };
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main
        id="main"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-12"
      >
        <StatusErrorCard copy={copy} message={message}>
          {children}
        </StatusErrorCard>
      </main>
      <AppFooter />
    </div>
  );
}

const CONNECTION_COPY: StatusCopy = {
  badge: 'Connection',
  title: 'Connection unavailable',
  summary: 'Studio could not load this workspace from the management API.',
  detail:
    'Organizations and projects did not respond. The API may be offline, unreachable from this browser, or rejecting the current session.',
  hints: [
    'Confirm the API is running on the configured host and port',
    'Check network, VPN, and exact origin allowlist settings',
    'Retry the connection or sign out and sign in again',
  ],
  Icon: Unplug,
  accent: 'text-rose-600 dark:text-rose-400',
  graphic: 'connection',
};

/** Centered 404-style panel for failed organization/project loads inside the console shell. */
export function WorkspaceConnectionError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-[min(40rem,calc(100svh-10rem))] w-full place-items-center justify-items-center">
      <StatusErrorCard copy={CONNECTION_COPY} message={message}>
        <div className="flex flex-wrap gap-2 pt-1">
          <ShadcnButton onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry workspace connection
          </ShadcnButton>
          <ShadcnButton variant="outline" asChild>
            <Link to="/overview">
              <Home data-icon="inline-start" />
              Overview
            </Link>
          </ShadcnButton>
        </div>
      </StatusErrorCard>
    </div>
  );
}

export function resolveHttpErrorCode(error: unknown): HttpErrorCode {
  if (!error || typeof error !== 'object') return 500;
  const value = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
  };
  const status = value.status ?? value.statusCode;
  if (status === 404) return 404;
  if (typeof status === 'number' && status >= 400 && status < 500) return 400;
  const code = String(value.code ?? '').toUpperCase();
  if (
    code === 'VALIDATION' ||
    code === 'BAD_REQUEST' ||
    code === 'INVALID_REQUEST' ||
    code === 'MIME_DENIED' ||
    code === 'SIZE_LIMIT'
  )
    return 400;
  if (code === 'NOT_FOUND') return 404;
  return 500;
}

function errorMessage(error: unknown) {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return undefined;
}

export function HttpErrorPage({
  code,
  message,
  onRetry,
}: {
  code: HttpErrorCode;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <ErrorShell code={code} message={message}>
      <div className="flex flex-wrap gap-2 pt-1">
        {onRetry ? (
          <ShadcnButton onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </ShadcnButton>
        ) : null}
        <ShadcnButton variant="outline" asChild>
          <Link to="/overview">
            <Home data-icon="inline-start" />
            Overview
          </Link>
        </ShadcnButton>
        <ShadcnButton
          variant="ghost"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) window.history.back();
          }}
        >
          <ArrowLeft data-icon="inline-start" />
          Go back
        </ShadcnButton>
      </div>
    </ErrorShell>
  );
}

/** Router `defaultErrorComponent` / root `errorComponent`. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const code = resolveHttpErrorCode(error);
  return (
    <HttpErrorPage
      code={code}
      message={errorMessage(error)}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

/** Router `defaultNotFoundComponent` / root `notFoundComponent`. */
export function RouteNotFoundPage(_props: NotFoundRouteProps) {
  return <HttpErrorPage code={404} />;
}
