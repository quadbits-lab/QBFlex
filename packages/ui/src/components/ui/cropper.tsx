import type { ComponentProps } from 'react';
import { Cropper as CropperPrimitive } from '@origin-space/image-cropper';
import { cn } from '../../lib/utils';

export type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function Cropper({ className, ...props }: ComponentProps<typeof CropperPrimitive.Root>) {
  return (
    <CropperPrimitive.Root
      data-slot="cropper"
      className={cn(
        'relative flex h-80 w-full cursor-move touch-none items-center justify-center overflow-hidden rounded-xl bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}

function CropperDescription({
  className,
  ...props
}: ComponentProps<typeof CropperPrimitive.Description>) {
  return (
    <CropperPrimitive.Description
      data-slot="cropper-description"
      className={cn('sr-only', className)}
      {...props}
    />
  );
}

function CropperImage({ className, ...props }: ComponentProps<typeof CropperPrimitive.Image>) {
  return (
    <CropperPrimitive.Image
      data-slot="cropper-image"
      className={cn('pointer-events-none h-full w-full select-none object-cover', className)}
      {...props}
    />
  );
}

function CropperCropArea({
  className,
  ...props
}: ComponentProps<typeof CropperPrimitive.CropArea>) {
  return (
    <CropperPrimitive.CropArea
      data-slot="cropper-crop-area"
      className={cn(
        'pointer-events-none absolute rounded-full border-2 border-background shadow-[0_0_0_9999px_color-mix(in_oklch,var(--foreground)_55%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export { Cropper, CropperDescription, CropperImage, CropperCropArea };
