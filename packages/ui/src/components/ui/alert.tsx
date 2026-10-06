import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded-md border px-3.5 py-3 text-sm [&>svg]:size-4 [&>svg]:absolute [&>svg]:top-3.5 [&>svg]:left-3.5 [&>svg+div]:translate-y-[-2px]',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground border-border',
        info: 'border-border bg-card text-card-foreground',
        success: 'border-success/40 bg-success/10 text-success [&>svg]:text-success',
        destructive:
          'border-destructive/40 bg-destructive/10 text-destructive-foreground [&>svg]:text-destructive-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('font-medium tracking-tight [&+*]:mt-1 [&_a]:underline', className)}
      {...props}
    />
  );
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-muted-foreground text-sm [&_a]:underline', className)}
      {...props}
    />
  );
}
export { Alert, alertVariants, AlertTitle, AlertDescription };
