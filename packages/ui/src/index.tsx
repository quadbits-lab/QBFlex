/**
 * QB Flex shared UI kit.
 *
 * Legacy components keep their exact public signatures for backward
 * compatibility; Modal/Drawer now delegate to the shadcn dialog primitive and
 * the theme is fully tokenized (see theme.css). New console-shell components
 * (Button/Input/Card/Select/…) follow the shadcn "new-york" style.
 */
export { cn } from './lib/utils';
export { Button as ShadcnButton, buttonVariants } from './components/ui/button';
export { Input } from './components/ui/input';
export { Label } from './components/ui/label';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/ui/card';
export { Badge as ShadcnBadge, badgeVariants } from './components/ui/badge';
export { Alert, AlertTitle, AlertDescription, alertVariants } from './components/ui/alert';
export { Skeleton } from './components/ui/skeleton';
export { Separator } from './components/ui/separator';
export { Switch } from './components/ui/switch';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './components/ui/tooltip';
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from './components/ui/dialog';
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from './components/ui/sheet';
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
} from './components/ui/select';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './components/ui/dropdown-menu';
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from './components/ui/table';
export { Toaster, toast, notifyError } from './components/ui/sonner';
export {
  Cropper,
  CropperDescription,
  CropperImage,
  CropperCropArea,
  type CropArea,
} from './components/ui/cropper';
export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandDialog,
} from './components/ui/command';
export { WorkflowCanvas } from './components/workflow-canvas';
// Charts stay on `@qb-flex/ui/charts` so SSR pages that only need shell
// primitives do not load @visx (extensionless ESM breaks Node's resolver).
export { Checkbox } from './components/ui/checkbox';
export { Textarea } from './components/ui/textarea';
export { Spinner } from './components/ui/spinner';
export {
  Empty as ShadcnEmpty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from './components/ui/empty';
export {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from './components/ui/field';
export {
  InputGroup,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupAddon,
} from './components/ui/input-group';
export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Legacy shared components — signatures preserved (docs + existing consumers).
// ---------------------------------------------------------------------------
import { useState, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, LoaderCircle, Info, CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from './components/ui/alert';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './components/ui/sheet';
import { Spinner } from './components/ui/spinner';
import { Button as ShadcnButton } from './components/ui/button';
import { Badge as ShadcnBadge } from './components/ui/badge';
import {
  Empty as ShadcnEmpty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from './components/ui/empty';
import {
  Dialog as ShadcnDialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './components/ui/dialog';
export function LegacyButton({
  variant = 'primary',
  className,
  onClick,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <ShadcnButton
        variant={variant}
        className={className}
        disabled={disabled || pending}
        onClick={
          onClick
            ? async (event) => {
                setError('');
                setPending(true);
                try {
                  await onClick(event);
                } catch (clickError) {
                  setError(clickError instanceof Error ? clickError.message : 'Action failed');
                } finally {
                  setPending(false);
                }
              }
            : undefined
        }
        {...props}
      />
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );
}
export function Button({
  variant,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <LegacyButton variant={variant} className={className} onClick={onClick} {...props} />;
}
export function Brand({ label = 'Studio', href = '/' }: { label?: string; href?: string }) {
  return (
    <a className="brand" href={href} aria-label={`QB Flex ${label} home`}>
      <img className="logo-dark" src="/brand/logo-dark.webp" alt="QB Flex" />
      <img className="logo-light" src="/brand/logo-light.webp" alt="QB Flex" />
      <span className="brand-label">{label}</span>
    </a>
  );
}
export function AppFooter() {
  return (
    <footer className="app-footer">
      <p>
        QBFlex © 2026 - Powered by{' '}
        <a href="https://lab.quadbits.io" target="_blank" rel="noopener noreferrer">
          Quadbits Lab
        </a>
      </p>
    </footer>
  );
}
export function LegacyBadge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function Badge({
  children,
  variant,
  ...props
}: Omit<React.ComponentProps<'span'>, 'variant'> & {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <ShadcnBadge variant={variant ?? 'outline'} {...props}>
      {children}
    </ShadcnBadge>
  );
}
const noticeIcon = {
  info: Info,
  error: CircleAlert,
  success: CircleCheck,
} as const;
export function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  const Icon = noticeIcon[kind];
  return (
    <Alert
      variant={kind === 'error' ? 'destructive' : 'default'}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
export function Loading() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <Spinner aria-hidden="true" />
      Loading…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ShadcnEmpty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
    </ShadcnEmpty>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        {description !== undefined ? (
          <DialogDescription>{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        )}
        {children}
      </DialogContent>
    </ShadcnDialog>
  );
}
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-80 max-w-[90vw] overflow-y-auto"
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription className="sr-only">Choose a section to navigate.</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
