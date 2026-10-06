import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';

function useDocumentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (notify) => {
      if (typeof document === 'undefined') return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
      return () => observer.disconnect();
    },
    () => (document.documentElement.classList.contains('light') ? 'light' : 'dark'),
    () => 'dark',
  );
}

function Toaster({
  position = 'bottom-right',
  richColors = true,
  closeButton = true,
  expand = false,
  duration = 4500,
  ...props
}: ToasterProps) {
  const theme = useDocumentTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position={position}
      richColors={richColors}
      closeButton={closeButton}
      expand={expand}
      duration={duration}
      visibleToasts={5}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

/** Normalize unknown failures into a toast error. */
function notifyError(error: unknown, fallback = 'Something went wrong') {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string' && error.trim()
        ? error
        : fallback;
  toast.error(message);
  return message;
}

export { Toaster, toast, notifyError };
