declare module '@origin-space/image-cropper' {
  import type * as React from 'react';

  export type Area = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  export interface CropperRootProps extends React.HTMLAttributes<HTMLDivElement> {
    image: string;
    cropPadding?: number;
    aspectRatio?: number;
    minZoom?: number;
    maxZoom?: number;
    zoomSensitivity?: number;
    keyboardStep?: number;
    zoom?: number;
    onCropChange?: (pixels: Area | null) => void;
    onZoomChange?: (zoom: number) => void;
    children: React.ReactNode;
  }

  export const Cropper: {
    Root: React.FC<CropperRootProps>;
    Image: React.FC<
      Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'style' | 'draggable' | 'src' | 'alt'>
    >;
    CropArea: React.FC<React.HTMLAttributes<HTMLDivElement>>;
    Description: React.FC<React.HTMLAttributes<HTMLDivElement>>;
  };
}
