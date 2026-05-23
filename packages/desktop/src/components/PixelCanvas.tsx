import { FC, useEffect, useRef } from "react";

export type Frame = "idle" | "working" | "thinking" | "happy";

interface FrameRect { x: number; y: number; w: number; h: number; }
interface SpriteMetadata { frames: Record<Frame, FrameRect>; fps?: number; }

interface Props {
  spriteUrl: string;
  metadataUrl?: string;
  frame: Frame;
  size?: number;
}

// Cache parsed metadata by URL so PixelCanvas instances don't re-fetch.
const METADATA_CACHE: Map<string, Promise<SpriteMetadata>> = new Map();

function loadMetadata(url: string): Promise<SpriteMetadata> {
  let cached = METADATA_CACHE.get(url);
  if (!cached) {
    cached = fetch(url).then((r) => r.json() as Promise<SpriteMetadata>);
    METADATA_CACHE.set(url, cached);
  }
  return cached;
}

export const PixelCanvas: FC<Props> = ({
  spriteUrl,
  metadataUrl,
  frame,
  size = 64,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    const resolvedMetaUrl = metadataUrl ?? spriteUrl.replace(/\.png$/, ".json");

    Promise.all([
      loadMetadata(resolvedMetaUrl),
      new Promise<HTMLImageElement>((resolveImg, reject) => {
        const img = new Image();
        img.onload = () => resolveImg(img);
        img.onerror = reject;
        img.src = spriteUrl;
      }),
    ]).then(([meta, img]) => {
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const fr = meta.frames[frame];
      if (!fr) return;
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, size, size);
    }).catch(() => { /* swallow — placeholder sprite may not load in tests */ });

    return () => { cancelled = true; };
  }, [spriteUrl, metadataUrl, frame, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated", display: "block" }}
      data-pixel-canvas
      data-frame={frame}
    />
  );
};

export default PixelCanvas;
