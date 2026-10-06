import { cn } from '../../lib/utils';
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'grid gap-1.5 text-[0.8125rem] font-medium select-none peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
export { Label };
