// Song embed helper (Sunday-Meeting v4 · 2026-06-21).
//
// The closing-song reveal now plays the video/track INLINE instead of
// kicking the family out to a new browser tab. This util turns a pasted
// YouTube / Spotify link into an embeddable player URL. Anything we can't
// embed falls back to "open in a new tab" so every link still works.
//
// Pure functions — no network, no DOM — safe to import anywhere.

export type SongProvider = 'youtube' | 'spotify' | null;

export interface SongEmbed {
  provider: SongProvider;
  /** iframe src that autoplays inline, or null when not embeddable. */
  embedUrl: string | null;
  /** the original link to open in a new tab (fallback / "open in app"). */
  watchUrl: string;
  /** convenience flag for callers. */
  embeddable: boolean;
}

/** Extract an 11-char YouTube video id from any common YouTube URL shape:
 *  watch?v=, youtu.be/, /embed/, /shorts/, /live/ — with extra params. */
export function parseYouTubeId(url: string): string | null {
  if (!url) return null;
  const u = url.trim();
  // youtu.be/<id>
  let m = u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/watch?v=<id>
  m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  m = u.match(/youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

/** Extract a Spotify {type,id} from an open.spotify.com or spotify: URI. */
export function parseSpotify(url: string): { type: string; id: string } | null {
  if (!url) return null;
  const u = url.trim();
  // https://open.spotify.com/track/<id>?... (also album/playlist/episode/show)
  let m = u.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  // spotify:track:<id>
  m = u.match(/spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  return null;
}

/**
 * Resolve a pasted link to an inline-playable embed.
 *  - YouTube → https://www.youtube.com/embed/<id> with autoplay + minimal chrome
 *  - Spotify → https://open.spotify.com/embed/<type>/<id>
 *  - anything else → not embeddable (caller opens watchUrl in a new tab)
 */
export function resolveSongEmbed(url: string, opts?: { autoplay?: boolean }): SongEmbed {
  const watchUrl = (url || '').trim();
  const autoplay = opts?.autoplay ?? true;

  const yt = parseYouTubeId(watchUrl);
  if (yt) {
    const params = new URLSearchParams({
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
      ...(autoplay ? { autoplay: '1' } : {}),
    });
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${yt}?${params.toString()}`,
      watchUrl,
      embeddable: true,
    };
  }

  const sp = parseSpotify(watchUrl);
  if (sp) {
    return {
      provider: 'spotify',
      // Spotify embeds don't honour an autoplay param (browser policy), but
      // they render an inline player the family can press play on.
      embedUrl: `https://open.spotify.com/embed/${sp.type}/${sp.id}`,
      watchUrl,
      embeddable: true,
    };
  }

  return { provider: null, embedUrl: null, watchUrl, embeddable: false };
}

/** Quick yes/no — does this link play inline? */
export function isEmbeddableSong(url: string): boolean {
  return resolveSongEmbed(url).embeddable;
}

/** A thumbnail image for a song link so it reads as a VIDEO card, not a raw
 *  URL. YouTube has stable thumbnail URLs; Spotify/others have none → null
 *  (callers fall back to a music-note tile). */
export function songThumbnailUrl(url: string): string | null {
  const id = parseYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
