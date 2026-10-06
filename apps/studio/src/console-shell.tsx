import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Database,
  Users,
  Code2,
  Zap,
  HardDrive,
  Box,
  Sparkles,
  Activity,
  Settings,
  BookOpen,
  ChevronRight,
  Plus,
  GitBranch,
  LogOut,
  PanelLeft,
  Search,
  Moon,
  Sun,
  FolderKanban,
  Building2,
} from 'lucide-react';
import {
  Brand,
  Skeleton,
  AppFooter,
  Badge,
  ShadcnButton as Button,
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  Separator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  toast,
  notifyError,
} from '@qb-flex/ui';
import { raw, docsURL } from './api';
import { useConsole } from './console-context';
import { NewProjectDialog } from './new-project-dialog';
import { UserAvatar } from './workspaces/account-profile';
import { ErrorMessage } from './workspaces/shared';

const navigation = [
  { name: 'Overview', path: '/overview', icon: LayoutDashboard, group: 'Workspace' },
  { name: 'Database', path: '/database', icon: Database, group: 'Build' },
  { name: 'Schema', path: '/schema', icon: GitBranch, group: 'Build' },
  { name: 'Authentication', path: '/auth', icon: Users, group: 'Build' },
  { name: 'API', path: '/api', icon: Code2, group: 'Build' },
  { name: 'Realtime', path: '/realtime', icon: Zap, group: 'Build' },
  { name: 'Storage', path: '/storage', icon: HardDrive, group: 'Build' },
  { name: 'Functions', path: '/functions', icon: Box, group: 'Build', planned: true },
  { name: 'AI & Vectors', path: '/ai', icon: Sparkles, group: 'Build', planned: true },
  { name: 'Backups', path: '/backups', icon: GitBranch, group: 'Manage' },
  { name: 'Activity', path: '/logs', icon: Activity, group: 'Manage' },
  { name: 'Settings', path: '/settings', icon: Settings, group: 'Manage' },
] as const;
const helpLinks: Record<string, string> = {
  '/overview': 'getting-started/first-project',
  '/database': 'database/schema',
  '/schema': 'database/schema',
  '/auth': 'authentication/overview',
  '/api': 'database/rest',
  '/realtime': 'realtime/row-events',
  '/storage': 'storage/files',
  '/backups': 'self-hosting/backups',
  '/logs': 'self-hosting/monitoring',
  '/settings': 'authentication/administrator-mfa',
};

export function ConsoleShell({ user, children }: { user: any; children: ReactNode }) {
  const { state, select, organizations, projects, relevant, branches, project } = useConsole();
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem('qb-console-sidebar') === 'collapsed');
    const enabled = localStorage.getItem('qb-studio-theme') === 'light';
    setLight(enabled);
    document.documentElement.classList.toggle('light', enabled);
  }, []);
  const toggleSidebar = () =>
    setCollapsed((v) => {
      localStorage.setItem('qb-console-sidebar', v ? 'expanded' : 'collapsed');
      return !v;
    });
  const toggleTheme = () =>
    setLight((v) => {
      document.documentElement.classList.toggle('light', !v);
      localStorage.setItem('qb-studio-theme', v ? 'dark' : 'light');
      return !v;
    });
  const current = navigation.find((n) => location.pathname.startsWith(n.path)) ?? navigation[0];
  const organization = organizations.data?.data.find((o: any) => o.id === state.organization);
  const signOut = async () => {
    try {
      await raw('/platform/auth/sign-out', 'POST', {});
      cache.clear();
      sessionStorage.removeItem('qb-console-context');
      await navigate({ to: '/sign-in' });
    } catch (error) {
      notifyError(error, 'Sign-out failed');
    }
  };
  const go = (path: string) => {
    setPalette(false);
    setMobile(false);
    void navigate({ to: path });
  };
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout>;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((v) => !v);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="combobox"]',
        ) ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      if (event.key === 'g') {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => (pendingG = false), 1200);
        return;
      }
      if (pendingG) {
        const path = {
          d: '/database',
          s: '/schema',
          o: '/overview',
          a: '/auth',
          l: '/logs',
          t: '/settings',
        }[event.key];
        if (path) {
          event.preventDefault();
          void navigate({ to: path });
        }
        pendingG = false;
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(timer);
    };
  }, [navigate]);

  const sidebar = (compact: boolean) => (
    <>
      <div className={cn('flex h-12 shrink-0 items-center px-4', compact && 'justify-center px-2')}>
        {compact ? (
          <Link
            to="/overview"
            aria-label="QB Flex Studio home"
            className="font-mono text-sm font-semibold tracking-tight"
          >
            QB
          </Link>
        ) : (
          <Brand href="/overview" />
        )}
      </div>
      <Separator />
      <div className={cn('p-3', compact && 'hidden')}>
        <Select
          value={state.organization || undefined}
          onValueChange={(v) => select({ organization: v, project: '', branch: 'primary' })}
        >
          <SelectTrigger aria-label="Organization" className="w-full">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="grid grid-cols-1 size-6 shrink-0 place-items-center rounded bg-muted text-xs"
                aria-hidden="true"
              >
                {organization?.name?.[0] ?? 'Q'}
              </span>
              <SelectValue placeholder="Organization" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {organizations.data?.data.map((o: any) => (
                <SelectItem value={o.id} key={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Workspaces" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {(['Workspace', 'Build', 'Manage'] as const).map((group) => (
          <div key={group} className="mb-4 flex flex-col gap-1">
            {!compact && (
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {group}
              </p>
            )}
            {navigation
              .filter((n) => n.group === group)
              .map((n) => (
                <Tooltip key={n.path}>
                  <TooltipTrigger asChild>
                    <Link
                      to={n.path}
                      aria-label={n.name}
                      aria-current={location.pathname === n.path ? 'page' : undefined}
                      onClick={() => setMobile(false)}
                      className={cn(
                        'flex h-9 shrink-0 items-center gap-3 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        location.pathname === n.path &&
                          'bg-sidebar-accent text-sidebar-foreground font-medium',
                        compact && 'justify-center px-0',
                      )}
                    >
                      <n.icon className="size-4 shrink-0" aria-hidden="true" />
                      {!compact && (
                        <>
                          <span>{n.name}</span>
                          {'planned' in n && (
                            <Badge variant="outline" className="ml-auto">
                              P1
                            </Badge>
                          )}
                        </>
                      )}
                    </Link>
                  </TooltipTrigger>
                  {compact && <TooltipContent side="right">{n.name}</TooltipContent>}
                </Tooltip>
              ))}
          </div>
        ))}
      </nav>
      <Separator />
      <div className="flex shrink-0 flex-col gap-2 p-3">
        <Button variant="ghost" asChild>
          <a href={docsURL} aria-label="Documentation">
            <BookOpen data-icon="inline-start" />
            {!compact && 'Documentation'}
          </a>
        </Button>
        {!compact && (
          <div className="flex items-center gap-2 rounded-md border p-2">
            <UserAvatar className="rounded-md" size="sm" user={user} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-xs font-medium">{user.name}</p>
              <p className="m-0 truncate text-[11px] text-muted-foreground">{user.email}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut />
            </Button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-svh bg-background">
        <aside
          aria-label="Primary navigation"
          className={cn(
            'fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar lg:flex',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          {sidebar(collapsed)}
        </aside>
        <Sheet open={mobile} onOpenChange={setMobile}>
          <SheetContent side="left" className="w-72 gap-0 p-0" showClose={false}>
            <SheetTitle className="sr-only">Studio navigation</SheetTitle>
            <SheetDescription className="sr-only">Choose a workspace.</SheetDescription>
            {sidebar(false)}
          </SheetContent>
        </Sheet>
        <div className={cn('flex min-w-0 flex-1 flex-col', collapsed ? 'lg:ml-16' : 'lg:ml-60')}>
          <header className="sticky top-0 z-20 flex min-h-12 flex-wrap items-center gap-2 border-b bg-background/95 px-3 backdrop-blur-sm sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!collapsed}
              onClick={toggleSidebar}
            >
              <PanelLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Toggle mobile navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <PanelLeft />
            </Button>
            <nav
              aria-label="Workspace context"
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
            >
              <div className="hidden min-w-0 items-center gap-1.5 xl:flex">
                <span className="inline-flex max-w-40 items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate font-medium text-foreground/90">
                    {organization?.name ?? 'Organization'}
                  </span>
                </span>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </div>

              <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border/80 bg-muted/25 px-2">
                <span className="hidden shrink-0 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:inline">
                  Project
                </span>
                <Select
                  value={state.project || undefined}
                  onValueChange={(v) => select({ project: v, branch: 'primary' })}
                >
                  <SelectTrigger
                    aria-label="Project"
                    className="h-7 min-h-7 w-[7.5rem] gap-1.5 border-0 bg-transparent px-1.5 py-0 shadow-none sm:w-40 [&_svg:not([class*='size-'])]:size-3.5"
                  >
                    <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {relevant.map((p: any) => (
                        <SelectItem value={p.id} key={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border/80 bg-muted/25 px-2">
                <span className="hidden shrink-0 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:inline">
                  Branch
                </span>
                <Select value={state.branch} onValueChange={(v) => select({ branch: v })}>
                  <SelectTrigger
                    aria-label="Branch"
                    className="h-7 min-h-7 w-[6.5rem] gap-1.5 border-0 bg-transparent px-1.5 py-0 shadow-none sm:w-32 [&_svg:not([class*='size-'])]:size-3.5"
                  >
                    <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="primary">main</SelectItem>
                      {(branches.data?.data ?? [])
                        .filter((b: any) => b.name !== 'main' && b.status === 'ready')
                        .map((b: any) => (
                          <SelectItem value={b.id} key={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="hidden items-center gap-1.5 md:flex">
                <Badge
                  variant={state.branch === 'primary' ? 'success' : 'warning'}
                  className="gap-1.5"
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      state.branch === 'primary' ? 'bg-success' : 'bg-warning',
                    )}
                    aria-hidden="true"
                  />
                  {state.branch === 'primary' ? 'Primary' : 'Restored'}
                </Badge>
                {project?.status && project.status !== 'ready' ? (
                  <Badge variant="warning" className="capitalize">
                    {project.status}
                  </Badge>
                ) : null}
                {project?.region ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {project.region}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Project region</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </nav>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                aria-label="Search commands"
                onClick={() => setPalette(true)}
              >
                <Search data-icon="inline-start" />
                <span className="hidden md:inline">Search</span>
                <kbd className="hidden rounded border px-1 text-[10px] text-muted-foreground md:inline">
                  ⌘ K
                </kbd>
              </Button>
              <Button
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setNewProject(true)}
                disabled={!state.organization}
              >
                <Plus data-icon="inline-start" />
                <span className="hidden xl:inline">New project</span>
                <span className="xl:hidden">New</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Account menu" className="overflow-hidden p-0">
                    <UserAvatar className="size-full rounded-md border-0" size="sm" user={user} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => go('/settings')}>
                      <Settings /> Account settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={toggleTheme}>
                      {light ? <Moon /> : <Sun />} {light ? 'Dark theme' : 'Light theme'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPalette(true)}>
                      <Search /> Search commands
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!state.organization}
                      onSelect={() => setNewProject(true)}
                    >
                      <Plus /> New project
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={docsURL + '/docs/' + (helpLinks[current.path] ?? 'roadmap/phases')}>
                        <BookOpen /> Help with {current.name}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void signOut()}>
                      <LogOut /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main
            id="main"
            className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          >
            {organizations.error || projects.error ? (
              <div className="flex flex-col gap-3">
                <ErrorMessage error={(organizations.error ?? projects.error) as Error} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void organizations.refetch();
                    void projects.refetch();
                  }}
                >
                  Retry workspace connection
                </Button>
              </div>
            ) : organizations.isPending || projects.isPending ? (
              <div className="flex flex-col gap-4" aria-label="Loading workspace">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : (
              children
            )}
          </main>
          <AppFooter />
        </div>
        <CommandDialog open={palette} onOpenChange={setPalette} title="Command palette">
          <CommandInput placeholder="Search pages and projects…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Workspaces">
              {navigation.map((n) => (
                <CommandItem key={n.path} onSelect={() => go(n.path)}>
                  <n.icon aria-hidden="true" />
                  {n.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {relevant.map((p: any) => (
                <CommandItem
                  key={p.id}
                  value={'project ' + p.name}
                  onSelect={() => {
                    select({ project: p.id, branch: 'primary' });
                    go('/overview');
                  }}
                >
                  <Box />
                  {p.name}
                </CommandItem>
              ))}
              <CommandItem
                disabled={!state.organization}
                onSelect={() => {
                  setPalette(false);
                  setNewProject(true);
                }}
              >
                <Plus />
                New project
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
        <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
      </div>
    </TooltipProvider>
  );
}
