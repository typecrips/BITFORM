# Bitform

A local-first image effects editor built with React, TypeScript, and Vite. Image processing runs in the browser; previews use a reduced-resolution canvas while raster exports use the source image dimensions.

## Run locally

```bash
npm ci
npm run dev
```

## Checks

```bash
npm run build
npm run lint
```

## Included tools

- Non-destructive effect stack with reorderable effects
- Grain, Black & White, Halftone, Dithering, Pixelate, Edge Detection, Sketch, Posterize, Chrome, X-Ray, Thermal Vision, ASCII, Clay Render, Root Rot, and Madness
- Built-in and custom presets
- Compare view and hold-original preview
- PNG/JPEG export
- SVG/PDF vectorization
- Preview zoom and pan

## Design

The interface uses a monochrome black-and-white theme with thin gray separators, square-cornered panels and controls, and rectangular range-slider thumbs.

## Processing and export

Images remain local in the browser. Vectorize traces the active effect stack at the source dimensions before producing SVG paths and PDF output. The preview zoom changes only the viewport and does not change export dimensions.
