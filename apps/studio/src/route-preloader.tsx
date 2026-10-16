import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Brand, cn } from '@qb-flex/ui';

/** Slim top progress bar — mounted in the root shell, driven by router state. */
export function RouteProgressBar() {
  const isLoading = useRouterState({ select: (state) => state.isLoading });
  const [visible, setVisible] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (isLoading) {
      setComplete(false);
      setVisible(true);
      return;
    }
    if (!visible) return;
    setComplete(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setComplete(false);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [isLoading, visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-transparent"
    >
      <div
        className={cn(
          'h-full origin-left bg-primary transition-transform ease-out',
          complete
            ? 'scale-x-100 duration-200'
            : 'animate-route-progress scale-x-[0.35] duration-700',
        )}
      />
    </div>
  );
}

/** Full-route pending UI — mounted via `defaultPendingComponent` / root `pendingComponent`. */
export function RoutePreloader() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid min-h-svh w-full place-items-center justify-items-center px-6"
    >
      <div className="flex w-full max-w-sm flex-col items-center justify-center gap-6 text-center">
        <Brand label="Studio" href="/" />
        <div className="relative grid size-28 place-items-center">
          <span
            className="absolute inset-0 animate-[spin_12s_linear_infinite] rounded-full border border-dashed border-border"
            aria-hidden="true"
          />
          <span
            className="absolute inset-3 rounded-full border border-border/70"
            aria-hidden="true"
          />
          <span className="absolute inset-0 animate-route-orbit rounded-full" aria-hidden="true">
            <span className="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)]" />
          </span>
          <img
            src="/brand/icon.webp"
            alt=""
            width={44}
            height={44}
            className="relative z-10 size-11 rounded-xl object-cover ring-1 ring-border"
            decoding="async"
          />
        </div>
        <div className="space-y-1.5">
          <p className="m-0 text-sm font-semibold tracking-tight text-foreground">
            Preparing workspace
          </p>
          <p className="m-0 text-sm text-muted-foreground">Loading the next route and its data…</p>
        </div>
        <div className="flex w-full max-w-[14rem] flex-col gap-2" aria-hidden="true">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 animate-route-indeterminate rounded-full bg-primary/80" />
          </div>
          <div className="flex justify-between text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            <span>Router</span>
            <span>Pending</span>
          </div>
        </div>
      </div>
    </div>
  );
}
