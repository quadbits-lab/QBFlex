import type { ReactNode } from 'react';
import { cn } from '@qb-flex/ui';

/** Vertical settings section nav (sidebar on desktop, wrap row on small screens). */
export const settingsNavListClassName =
  'flex h-auto w-full flex-row flex-wrap gap-1 rounded-none border-0 bg-transparent p-0 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-0.5 xl:w-52';

export const settingsNavTriggerClassName =
  'inline-flex w-auto justify-start rounded-md border-0 bg-transparent px-3 py-2 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none lg:w-full';

/** Shell: settings sidebar + content. */
export function SettingsShellLayout({
  nav,
  children,
  className,
}: {
  nav: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-8',
        className,
      )}
    >
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">{nav}</aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Main column for settings panels. */
export function SettingsMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('min-w-0 flex-1 space-y-4', className)}>{children}</div>;
}

/**
 * Structured settings block: sticky section meta on the left, bordered content card on the right.
 */
export function SettingsFormSection({
  title,
  description,
  children,
  footer,
  className,
  tone = 'default',
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]',
        className,
      )}
    >
      <div className="min-w-0 lg:sticky lg:top-20 lg:self-start lg:pt-1">
        <h2
          className={cn(
            'm-0 text-sm font-semibold tracking-tight',
            tone === 'danger' ? 'text-destructive' : 'text-foreground',
          )}
        >
          {title}
        </h2>
        {description ? (
          <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-xl border bg-card shadow-none',
          tone === 'danger' ? 'border-destructive/35' : 'border-border',
        )}
      >
        <div className="space-y-5 p-5 sm:p-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Soft callout banner with optional actions. */
export function SettingsBanner({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 text-sm text-muted-foreground">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Nested field group inside a settings card. */
export function SettingsFieldGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {title || description ? (
        <div className="space-y-1">
          {title ? <p className="m-0 text-sm font-medium">{title}</p> : null}
          {description ? (
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Destructive actions block. */
export function DangerCard({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold">{title}</p>
        {description ? (
          <p className="mt-1 mb-0 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** @deprecated Prefer SettingsShellLayout. */
export function SettingsShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('min-w-0', className)}>{children}</div>;
}

/** @deprecated Prefer SettingsFormSection. */
export function SettingsPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SettingsFormSection
      className={className}
      description={description}
      footer={action}
      title={title}
    >
      {children}
    </SettingsFormSection>
  );
}

/** @deprecated Prefer SettingsFieldGroup. */
export function SettingsSectionGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('space-y-5', className)}>{children}</div>;
}

/** @deprecated Prefer SettingsFieldGroup. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SettingsFieldGroup className={className} description={description} title={title}>
      {children}
    </SettingsFieldGroup>
  );
}

/** @deprecated Prefer DangerCard. */
export function DangerZone({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DangerCard action={children} className={className} description={description} title={title} />
  );
}
