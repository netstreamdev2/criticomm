'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Canvas signature capture — replaces V4's signature-pad on the Paramedic PCR.
 * Writes a base64 PNG (no data: prefix, matching V4 storage format) into a
 * hidden input so plain server-action forms pick it up.
 */
export function SignaturePad({
  name, label, defaultValue,
}: {
  name: string; label: string; defaultValue?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(Boolean(defaultValue));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // White background so the exported PNG is legible on paper
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (defaultValue) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = `data:image/png;base64,${defaultValue}`;
    }
  }, [defaultValue]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const dataUrl = e.currentTarget.toDataURL('image/png');
    if (inputRef.current) {
      inputRef.current.value = dataUrl.replace(/^data:image\/png;base64,/, '');
    }
    setSigned(true);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (inputRef.current) inputRef.current.value = '';
    setSigned(false);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-muted-foreground hover:text-fg"
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={400}
        height={140}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full cursor-crosshair touch-none rounded-md border border-border bg-white"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {signed ? '✓ Signature captured' : 'Sign with mouse or finger'}
      </p>
      <input ref={inputRef} type="hidden" name={name} defaultValue={defaultValue ?? ''} />
    </div>
  );
}
