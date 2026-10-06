import { useState, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, LoaderCircle } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));
const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
  },
  defaultVariants: { variant: 'primary' },
});
export function Button({
  variant,
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        className={cn(buttonVariants({ variant }), className)}
        {...props}
        disabled={props.disabled || pending}
        onClick={
          onClick
            ? async (event) => {
                setError('');
                setPending(true);
                try {
                  await onClick(event);
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Action failed');
                } finally {
                  setPending(false);
                }
              }
            : undefined
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );
}
export function Brand({ label = 'Studio' }: { label?: string }) {
  return (
    <a className="brand" href="/" aria-label={`QB Flex ${label} home`}>
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
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`notice notice-${kind}`}>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={18} /> Loading…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal"
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            {description ?? 'Configure the selected resource.'}
          </Dialog.Description>
          {children}
          <Dialog.Close className="modal-close" aria-label="Close dialog">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="drawer"
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Choose a section to navigate.</Dialog.Description>
          {children}
          <Dialog.Close className="modal-close" aria-label="Close navigation">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
