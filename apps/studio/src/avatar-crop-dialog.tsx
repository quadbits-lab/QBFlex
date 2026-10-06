import { useEffect, useState } from 'react';
import {
  Cropper,
  CropperCropArea,
  CropperDescription,
  CropperImage,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  ShadcnButton,
  Spinner,
  type CropArea,
} from '@qb-flex/ui';

async function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

async function cropToPng(src: string, area: CropArea, outputSize = 512) {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to crop image');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    outputSize,
    outputSize,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Unable to crop image');
  return blob;
}

export function AvatarCropDialog({
  open,
  imageSrc,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  imageSrc: string | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (file: File) => void | Promise<void>;
}) {
  const [area, setArea] = useState<CropArea | null>(null);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [cropping, setCropping] = useState(false);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setArea(null);
      setZoom(1);
      setCropping(false);
      return;
    }
    // Wait for dialog open animation so cropper measures the final size.
    const timer = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(timer);
  }, [open, imageSrc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md duration-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
        showClose={!pending && !cropping}
      >
        <DialogTitle>Crop avatar</DialogTitle>
        <DialogDescription>
          Drag to reposition and use the slider to zoom. The circular area is uploaded.
        </DialogDescription>
        <div className="space-y-4">
          {imageSrc && ready ? (
            <Cropper
              key={imageSrc}
              image={imageSrc}
              aspectRatio={1}
              zoom={zoom}
              onZoomChange={setZoom}
              onCropChange={setArea}
              className="h-72"
            >
              <CropperDescription>
                Use arrow keys to pan and the mouse wheel or zoom slider to adjust your avatar crop.
              </CropperDescription>
              <CropperImage />
              <CropperCropArea />
            </Cropper>
          ) : (
            <div className="grid h-72 place-items-center rounded-xl border border-border bg-muted">
              <Spinner />
            </div>
          )}
          <Field>
            <FieldLabel htmlFor="avatar-zoom">Zoom</FieldLabel>
            <Input
              id="avatar-zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              disabled={!ready || pending || cropping}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <ShadcnButton
              variant="outline"
              disabled={pending || cropping}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </ShadcnButton>
            <ShadcnButton
              disabled={!area || !imageSrc || pending || cropping}
              onClick={async () => {
                if (!area || !imageSrc) return;
                setCropping(true);
                try {
                  const blob = await cropToPng(imageSrc, area);
                  const file = new File([blob], 'avatar.png', { type: 'image/png' });
                  await onConfirm(file);
                } finally {
                  setCropping(false);
                }
              }}
            >
              {pending || cropping ? <Spinner data-icon="inline-start" /> : null}
              Save avatar
            </ShadcnButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
