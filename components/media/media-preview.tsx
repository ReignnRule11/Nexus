"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import type { PublicMedia } from "@/lib/client/types";

export function MediaPreview({ media }: { media: PublicMedia }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ download: { url: string } }>(`/api/media/${media.id}`)
      .then((body) => {
        if (!cancelled) {
          setUrl(body.download.url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [media.id]);

  if (!url) {
    return <p className="muted">{media.filename}</p>;
  }

  return (
    // Signed private media URLs are not Next.js Image origins.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={media.filename}
      className="media-image"
      width={640}
      height={640}
      loading="lazy"
    />
  );
}
