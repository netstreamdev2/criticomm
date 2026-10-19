'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/i18n';

/** The type a browser plays a voice note as, from its file name. */
function playableType(filename: string, stored: string | null) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'audio/mp4';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  return stored ?? 'audio/mp4';
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A voice note from the field, played in the console.
 *
 * Phones record AAC in MP4 and write the file's index after the audio, and
 * earlier builds stored the notes as "audio/m4a", a type browsers do not
 * recognise. Streamed straight from storage such a note could show 0:00 or
 * refuse to play. Fetched whole (they are small) and handed to the player
 * with the right type, every note plays and shows its real length.
 */
export function VoiceNote({ url, filename, contentType }: { url: string; filename: string; contentType: string | null }) {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.arrayBuffer();
      })
      .then((bytes) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: playableType(filename, contentType) }));
        setSrc(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, filename, contentType]);

  if (failed) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
        {t('Could not load the voice note here: open it')}</a>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {/* biome-ignore lint/a11y/useMediaCaption: field voice notes have no transcript */}
      <audio
        controls
        preload="metadata"
        src={src ?? undefined}
        className="h-9 w-full"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setSeconds(d);
        }}
      />
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {src ? (seconds !== null ? clock(seconds) : '') : '…'}
      </span>
    </div>
  );
}
