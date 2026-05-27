// Global catalogue for Household → Subscriptions & Contributions.
//
// Static, code-versioned list of common items every family can pick
// from before their own catalogue has been seeded by usage. Filtered by
// the family's country (`family.location.country`); items tagged
// `'global'` show everywhere.
//
// Picking a global item creates a fresh entry in the per-family
// catalogue (`/families/{f}/catalogue_subs` or `catalogue_contribs`) —
// the global list itself is read-only.

import type { SubscriptionCategory } from './subscriptions';
import type { ContributionCategory } from './contributions';

// ── Country groups (ISO 3166 alpha-2) ────────────────────────────────

export const EAST_AFRICA   = ['TZ', 'KE', 'UG', 'RW', 'BI', 'SS'] as const;
export const SOUTHERN_AFR  = ['ZA', 'BW', 'NA', 'ZM', 'ZW', 'MW', 'MZ', 'LS', 'SZ'] as const;
export const WEST_AFRICA   = ['NG', 'GH', 'SN', 'CI', 'CM', 'BF', 'ML', 'BJ', 'TG', 'NE'] as const;
export const NORTH_AFRICA  = ['EG', 'MA', 'TN', 'DZ', 'LY', 'SD'] as const;
export const HORN_AFRICA   = ['ET', 'ER', 'DJ', 'SO'] as const;
export const AFRICA = [
  ...EAST_AFRICA, ...SOUTHERN_AFR, ...WEST_AFRICA,
  ...NORTH_AFRICA, ...HORN_AFRICA,
] as const;

export const US_CA           = ['US', 'CA'] as const;
export const UK_IRELAND      = ['GB', 'IE'] as const;
export const OCEANIA         = ['AU', 'NZ'] as const;
export const INDIA_SUBCONT   = ['IN', 'PK', 'BD', 'LK', 'NP'] as const;
export const MIDDLE_EAST     = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB'] as const;
export const EUROPE_WESTERN  = ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'PT', 'SE', 'NO', 'DK', 'FI', 'IS', 'LU', 'GR'] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface GlobalSubItem {
  id: string;
  name: string;
  category: SubscriptionCategory;
  subCategory: string;
  defaultPlatform: 'web' | 'ios' | 'android' | 'other' | null;
  /** ISO alpha-2 country codes the service is available in, or `'global'`. */
  countries: readonly string[];
  /** UI emoji used in the browse list. */
  emoji: string;
  /** Higher floats earlier in lists. */
  popularity: number;
}

export interface GlobalContribItem {
  id: string;
  recipientName: string;
  recipientType: 'organization' | 'cause' | 'community' | 'person';
  category: ContributionCategory;
  subCategory: string;
  countries: readonly string[];
  emoji: string;
  popularity: number;
}

// ── Filter helpers ───────────────────────────────────────────────────

/** Item visible to a family in `country` if it's tagged global or includes that country. */
function matchesCountry(item: { countries: readonly string[] }, country: string): boolean {
  return item.countries.includes('global') || item.countries.includes(country);
}

export function filterGlobalSubsForCountry(
  country: string,
  pool: readonly GlobalSubItem[] = GLOBAL_SUB_ITEMS,
): GlobalSubItem[] {
  return pool
    .filter((it) => matchesCountry(it, country))
    .slice()
    .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
}

export function filterGlobalContribsForCountry(
  country: string,
  pool: readonly GlobalContribItem[] = GLOBAL_CONTRIB_ITEMS,
): GlobalContribItem[] {
  return pool
    .filter((it) => matchesCountry(it, country))
    .slice()
    .sort((a, b) => b.popularity - a.popularity || a.recipientName.localeCompare(b.recipientName));
}

// ─────────────────────────────────────────────────────────────────────
// Global Subscriptions
// ─────────────────────────────────────────────────────────────────────

export const GLOBAL_SUB_ITEMS: readonly GlobalSubItem[] = [

  // ── Streaming Video (media) ─────────────────────────────────────────
  { id: 'netflix',          name: 'Netflix',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '🎬', popularity: 100 },
  { id: 'youtube-premium',  name: 'YouTube Premium',      category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '📺', popularity: 95 },
  { id: 'amazon-prime-video', name: 'Amazon Prime Video', category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '📦', popularity: 92 },
  { id: 'disney-plus',      name: 'Disney+',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '🏰', popularity: 88 },
  { id: 'max',              name: 'Max (HBO)',            category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND, ...EUROPE_WESTERN, ...OCEANIA, ...INDIA_SUBCONT], emoji: '🎥', popularity: 80 },
  { id: 'hulu',             name: 'Hulu',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA], emoji: '📺', popularity: 78 },
  { id: 'apple-tv-plus',    name: 'Apple TV+',            category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '🍎', popularity: 75 },
  { id: 'paramount-plus',   name: 'Paramount+',           category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND, ...OCEANIA, ...EUROPE_WESTERN], emoji: '⛰️', popularity: 70 },
  { id: 'peacock',          name: 'Peacock',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND], emoji: '🦚', popularity: 65 },
  { id: 'espn-plus',        name: 'ESPN+',                category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA], emoji: '🏈', popularity: 60 },
  { id: 'crunchyroll',      name: 'Crunchyroll',          category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '🍥', popularity: 58 },
  { id: 'britbox',          name: 'BritBox',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...UK_IRELAND, ...US_CA, ...OCEANIA, ...SOUTHERN_AFR], emoji: '🇬🇧', popularity: 50 },
  { id: 'mubi',             name: 'MUBI',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: ['global'], emoji: '🎞️', popularity: 45 },
  { id: 'discovery-plus',   name: 'Discovery+',           category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND, ...EUROPE_WESTERN], emoji: '🌍', popularity: 50 },

  // East / Southern Africa pay-TV & streaming
  { id: 'dstv',             name: 'DStv',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'other', countries: [...AFRICA], emoji: '📡', popularity: 95 },
  { id: 'gotv',             name: 'GOtv',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'other', countries: [...AFRICA], emoji: '📺', popularity: 80 },
  { id: 'showmax',          name: 'Showmax',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...AFRICA], emoji: '🎬', popularity: 85 },
  { id: 'azam-tv',          name: 'Azam TV',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'other', countries: [...EAST_AFRICA], emoji: '⭐', popularity: 88 },
  { id: 'startimes',        name: 'StarTimes',            category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'other', countries: [...AFRICA], emoji: '🌟', popularity: 70 },
  { id: 'canal-plus',       name: 'Canal+',               category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'other', countries: [...WEST_AFRICA, ...NORTH_AFRICA, ...EUROPE_WESTERN], emoji: '🇫🇷', popularity: 60 },
  { id: 'iroko-tv',         name: 'iROKO TV',             category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...AFRICA], emoji: '🎭', popularity: 50 },

  // India subcontinent streaming
  { id: 'jiocinema',        name: 'JioCinema',            category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...INDIA_SUBCONT], emoji: '🎬', popularity: 80 },
  { id: 'hotstar',          name: 'Disney+ Hotstar',      category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...INDIA_SUBCONT], emoji: '⭐', popularity: 85 },
  { id: 'zee5',             name: 'ZEE5',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...INDIA_SUBCONT], emoji: '🎥', popularity: 70 },
  { id: 'sonyliv',          name: 'SonyLIV',              category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...INDIA_SUBCONT], emoji: '📺', popularity: 60 },

  // Middle East streaming
  { id: 'shahid',           name: 'Shahid VIP',           category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...MIDDLE_EAST, ...NORTH_AFRICA], emoji: '🎬', popularity: 70 },
  { id: 'starzplay',        name: 'STARZPLAY',            category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...MIDDLE_EAST, ...NORTH_AFRICA], emoji: '⭐', popularity: 55 },
  { id: 'osn-plus',         name: 'OSN+',                 category: 'media', subCategory: 'Streaming Video', defaultPlatform: 'web', countries: [...MIDDLE_EAST], emoji: '🌙', popularity: 50 },

  // ── Streaming Music (media) ─────────────────────────────────────────
  { id: 'spotify',          name: 'Spotify',              category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🎧', popularity: 100 },
  { id: 'apple-music',      name: 'Apple Music',          category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🎵', popularity: 95 },
  { id: 'youtube-music',    name: 'YouTube Music',        category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🎶', popularity: 90 },
  { id: 'amazon-music',     name: 'Amazon Music Unlimited', category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '📦', popularity: 80 },
  { id: 'tidal',            name: 'Tidal',                category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🌊', popularity: 60 },
  { id: 'deezer',           name: 'Deezer',               category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🎼', popularity: 55 },
  { id: 'soundcloud-go',    name: 'SoundCloud Go',        category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 50 },
  { id: 'boomplay',         name: 'Boomplay',             category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: [...AFRICA], emoji: '🎤', popularity: 70 },
  { id: 'mdundo',           name: 'Mdundo',               category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: [...EAST_AFRICA], emoji: '🥁', popularity: 50 },
  { id: 'audius',           name: 'Audius',               category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: ['global'], emoji: '🎵', popularity: 30 },
  { id: 'pandora-plus',     name: 'Pandora Plus',         category: 'media', subCategory: 'Streaming Music', defaultPlatform: 'web', countries: [...US_CA], emoji: '📻', popularity: 45 },

  // ── News & Print (media) ────────────────────────────────────────────
  { id: 'nytimes',          name: 'The New York Times',   category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '📰', popularity: 80 },
  { id: 'wsj',              name: 'The Wall Street Journal', category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '📈', popularity: 70 },
  { id: 'washington-post',  name: 'The Washington Post',  category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '🗞️', popularity: 65 },
  { id: 'the-economist',    name: 'The Economist',        category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '📊', popularity: 70 },
  { id: 'financial-times',  name: 'Financial Times',      category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '💹', popularity: 65 },
  { id: 'bloomberg',        name: 'Bloomberg',            category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '📉', popularity: 60 },
  { id: 'the-athletic',     name: 'The Athletic',         category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND], emoji: '🏟️', popularity: 50 },
  { id: 'the-guardian',     name: 'The Guardian',         category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '📰', popularity: 60 },
  { id: 'medium',           name: 'Medium',               category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '✍️', popularity: 55 },
  { id: 'substack',         name: 'Substack',             category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['global'], emoji: '✉️', popularity: 60 },
  { id: 'daily-nation',     name: 'Daily Nation',         category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: [...EAST_AFRICA], emoji: '🗞️', popularity: 70 },
  { id: 'the-citizen-tz',   name: 'The Citizen (Tanzania)', category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['TZ'], emoji: '🗞️', popularity: 70 },
  { id: 'mwananchi',        name: 'Mwananchi',            category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['TZ'], emoji: '🗞️', popularity: 65 },
  { id: 'standard-ke',      name: 'The Standard (Kenya)', category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: ['KE'], emoji: '🗞️', popularity: 65 },
  { id: 'business-daily-africa', name: 'Business Daily Africa', category: 'media', subCategory: 'Print / Digital News', defaultPlatform: 'web', countries: [...AFRICA], emoji: '💼', popularity: 55 },

  // ── Gaming (media) ──────────────────────────────────────────────────
  { id: 'xbox-game-pass',   name: 'Xbox Game Pass',       category: 'media', subCategory: 'Gaming', defaultPlatform: 'other', countries: ['global'], emoji: '🎮', popularity: 80 },
  { id: 'playstation-plus', name: 'PlayStation Plus',     category: 'media', subCategory: 'Gaming', defaultPlatform: 'other', countries: ['global'], emoji: '🎮', popularity: 80 },
  { id: 'nintendo-online',  name: 'Nintendo Switch Online', category: 'media', subCategory: 'Gaming', defaultPlatform: 'other', countries: ['global'], emoji: '🎮', popularity: 70 },
  { id: 'ea-play',          name: 'EA Play',              category: 'media', subCategory: 'Gaming', defaultPlatform: 'other', countries: ['global'], emoji: '🎮', popularity: 55 },
  { id: 'apple-arcade',     name: 'Apple Arcade',         category: 'media', subCategory: 'Gaming', defaultPlatform: 'ios', countries: ['global'], emoji: '🕹️', popularity: 50 },
  { id: 'roblox-premium',   name: 'Roblox Premium',       category: 'media', subCategory: 'Gaming', defaultPlatform: 'web', countries: ['global'], emoji: '🧱', popularity: 70 },
  { id: 'minecraft-realms', name: 'Minecraft Realms',     category: 'media', subCategory: 'Gaming', defaultPlatform: 'other', countries: ['global'], emoji: '⛏️', popularity: 55 },
  { id: 'geforce-now',      name: 'NVIDIA GeForce NOW',   category: 'media', subCategory: 'Gaming', defaultPlatform: 'web', countries: ['global'], emoji: '🎮', popularity: 45 },

  // ── Cloud Storage (mobile_apps) ─────────────────────────────────────
  { id: 'icloud-plus',      name: 'iCloud+',              category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'ios', countries: ['global'], emoji: '☁️', popularity: 95 },
  { id: 'google-one',       name: 'Google One',           category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 95 },
  { id: 'dropbox',          name: 'Dropbox',              category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '📦', popularity: 75 },
  { id: 'onedrive',         name: 'Microsoft OneDrive',   category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 70 },
  { id: 'box',              name: 'Box',                  category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '📦', popularity: 55 },
  { id: 'pcloud',           name: 'pCloud',               category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 45 },
  { id: 'mega',             name: 'MEGA',                 category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '🔐', popularity: 45 },
  { id: 'sync-com',         name: 'Sync.com',             category: 'mobile_apps', subCategory: 'Cloud Storage', defaultPlatform: 'web', countries: ['global'], emoji: '🔄', popularity: 35 },

  // ── AI Tools (mobile_apps) ──────────────────────────────────────────
  { id: 'chatgpt-plus',     name: 'ChatGPT Plus',         category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🤖', popularity: 100 },
  { id: 'chatgpt-pro',      name: 'ChatGPT Pro',          category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🧠', popularity: 70 },
  { id: 'claude-pro',       name: 'Claude Pro',           category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🪶', popularity: 90 },
  { id: 'claude-max',       name: 'Claude Max',           category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🪶', popularity: 65 },
  { id: 'gemini-advanced',  name: 'Gemini Advanced',      category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '✨', popularity: 80 },
  { id: 'perplexity-pro',   name: 'Perplexity Pro',       category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🔎', popularity: 70 },
  { id: 'midjourney',       name: 'Midjourney',           category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🎨', popularity: 65 },
  { id: 'github-copilot',   name: 'GitHub Copilot',       category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🐙', popularity: 70 },
  { id: 'cursor',           name: 'Cursor Pro',           category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '⌨️', popularity: 65 },
  { id: 'runway',           name: 'Runway',               category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🎞️', popularity: 50 },
  { id: 'elevenlabs',       name: 'ElevenLabs',           category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '🎙️', popularity: 50 },
  { id: 'notion-ai',        name: 'Notion AI',            category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '📝', popularity: 60 },
  { id: 'grammarly',        name: 'Grammarly Premium',    category: 'mobile_apps', subCategory: 'AI Tools', defaultPlatform: 'web', countries: ['global'], emoji: '✍️', popularity: 70 },

  // ── Cross-platform Apps (mobile_apps) ───────────────────────────────
  { id: 'evernote-personal', name: 'Evernote Personal',   category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🐘', popularity: 50 },
  { id: 'todoist-premium',  name: 'Todoist Premium',      category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '✅', popularity: 55 },
  { id: 'fantastical',      name: 'Fantastical',          category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'ios', countries: ['global'], emoji: '🗓️', popularity: 45 },
  { id: 'readwise',         name: 'Readwise',             category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '📚', popularity: 45 },
  { id: 'pocket-premium',   name: 'Pocket Premium',       category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🔖', popularity: 40 },
  { id: 'duolingo-super',   name: 'Duolingo Super',       category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🦉', popularity: 75 },
  { id: 'headspace',        name: 'Headspace',            category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🧘', popularity: 70 },
  { id: 'calm',             name: 'Calm',                 category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🌅', popularity: 65 },

  // VPN / Security
  { id: 'nordvpn',          name: 'NordVPN',              category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🛡️', popularity: 75 },
  { id: 'expressvpn',       name: 'ExpressVPN',           category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🛡️', popularity: 65 },
  { id: 'protonvpn',        name: 'Proton VPN',           category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🛡️', popularity: 55 },
  { id: 'protonmail',       name: 'Proton Mail',          category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '✉️', popularity: 50 },
  { id: '1password',        name: '1Password',            category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🔑', popularity: 70 },
  { id: 'lastpass',         name: 'LastPass Premium',     category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🔐', popularity: 55 },
  { id: 'dashlane',         name: 'Dashlane',             category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🔐', popularity: 45 },
  { id: 'bitwarden-premium', name: 'Bitwarden Premium',   category: 'mobile_apps', subCategory: 'Cross-platform', defaultPlatform: 'web', countries: ['global'], emoji: '🔐', popularity: 50 },

  // ── Web / SaaS (professional, productivity) ─────────────────────────
  { id: 'microsoft-365',    name: 'Microsoft 365',        category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🅼', popularity: 95 },
  { id: 'google-workspace', name: 'Google Workspace',     category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🅖', popularity: 90 },
  { id: 'notion',           name: 'Notion',               category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📝', popularity: 85 },
  { id: 'slack',            name: 'Slack',                category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '💬', popularity: 85 },
  { id: 'zoom',             name: 'Zoom',                 category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📹', popularity: 85 },
  { id: 'figma',            name: 'Figma',                category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🎨', popularity: 75 },
  { id: 'canva-pro',        name: 'Canva Pro',            category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🎨', popularity: 80 },
  { id: 'adobe-cc',         name: 'Adobe Creative Cloud', category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🅰️', popularity: 80 },
  { id: 'linear',           name: 'Linear',               category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📐', popularity: 55 },
  { id: 'asana',            name: 'Asana',                category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '✅', popularity: 60 },
  { id: 'trello-premium',   name: 'Trello Premium',       category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📋', popularity: 50 },
  { id: 'monday',           name: 'monday.com',           category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📅', popularity: 55 },
  { id: 'clickup',          name: 'ClickUp',              category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '⏫', popularity: 50 },
  { id: 'airtable',         name: 'Airtable',             category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🗂️', popularity: 60 },
  { id: 'calendly',         name: 'Calendly',             category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📅', popularity: 55 },
  { id: 'loom',             name: 'Loom',                 category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📹', popularity: 50 },
  { id: 'descript',         name: 'Descript',             category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🎙️', popularity: 40 },
  { id: 'mailchimp',        name: 'Mailchimp',            category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🐵', popularity: 55 },
  { id: 'hubspot',          name: 'HubSpot',              category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '🧲', popularity: 55 },
  { id: 'quickbooks-online', name: 'QuickBooks Online',   category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📒', popularity: 60 },
  { id: 'xero',             name: 'Xero',                 category: 'professional', subCategory: 'Productivity SaaS (work)', defaultPlatform: 'web', countries: ['global'], emoji: '📒', popularity: 55 },

  // Developer tools (professional)
  { id: 'github-pro',       name: 'GitHub Pro',           category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '🐙', popularity: 60 },
  { id: 'gitlab',           name: 'GitLab',               category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '🦊', popularity: 50 },
  { id: 'jetbrains',        name: 'JetBrains Subscription', category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '🧪', popularity: 50 },
  { id: 'vercel-pro',       name: 'Vercel Pro',           category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '▲', popularity: 50 },
  { id: 'netlify-pro',      name: 'Netlify Pro',          category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '🌐', popularity: 45 },
  { id: 'cloudflare-pro',   name: 'Cloudflare Pro',       category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '⛅', popularity: 45 },
  { id: 'aws',              name: 'Amazon Web Services',  category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 65 },
  { id: 'gcp',              name: 'Google Cloud Platform', category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 55 },
  { id: 'azure',            name: 'Microsoft Azure',      category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '☁️', popularity: 55 },
  { id: 'digitalocean',     name: 'DigitalOcean',         category: 'professional', subCategory: 'Developer tools', defaultPlatform: 'web', countries: ['global'], emoji: '🌊', popularity: 50 },

  // Domains & hosting
  { id: 'godaddy',          name: 'GoDaddy',              category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '🌐', popularity: 55 },
  { id: 'namecheap',        name: 'Namecheap',            category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '🌐', popularity: 50 },
  { id: 'squarespace',      name: 'Squarespace',          category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '◼️', popularity: 50 },
  { id: 'wix',              name: 'Wix',                  category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '🌐', popularity: 50 },
  { id: 'wordpress-com',    name: 'WordPress.com',        category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '✏️', popularity: 50 },
  { id: 'shopify',          name: 'Shopify',              category: 'professional', subCategory: 'Domains & hosting', defaultPlatform: 'web', countries: ['global'], emoji: '🛍️', popularity: 60 },

  // ── Memberships ─────────────────────────────────────────────────────
  { id: 'amazon-prime',     name: 'Amazon Prime',         category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'web', countries: ['global'], emoji: '📦', popularity: 95 },
  { id: 'costco',           name: 'Costco Membership',    category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'other', countries: [...US_CA, ...UK_IRELAND, 'JP', 'KR', 'AU', 'MX', 'ES', 'FR', 'CN', 'TW'], emoji: '🛒', popularity: 75 },
  { id: 'sams-club',        name: "Sam's Club",           category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'other', countries: [...US_CA, 'MX'], emoji: '🛒', popularity: 60 },
  { id: 'aaa',              name: 'AAA (Auto Club)',      category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'other', countries: [...US_CA], emoji: '🚙', popularity: 55 },
  { id: 'aarp',             name: 'AARP',                 category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'other', countries: [...US_CA], emoji: '👴', popularity: 50 },
  { id: 'audible',          name: 'Audible',              category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'web', countries: ['global'], emoji: '🎧', popularity: 75 },
  { id: 'patreon',          name: 'Patreon',              category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'web', countries: ['global'], emoji: '🎨', popularity: 60 },
  { id: 'onlyfans',         name: 'OnlyFans',             category: 'memberships', subCategory: 'Loyalty (paid tier)', defaultPlatform: 'web', countries: ['global'], emoji: '🔒', popularity: 30 },
  { id: 'royal-society',    name: 'Royal Society (UK)',   category: 'memberships', subCategory: 'Business / Professional Body', defaultPlatform: 'other', countries: [...UK_IRELAND], emoji: '🎓', popularity: 25 },

  // ── Gym / Sports memberships ────────────────────────────────────────
  { id: 'gym-membership',   name: 'Gym Membership',       category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'other', countries: ['global'], emoji: '🏋️', popularity: 95 },
  { id: 'planet-fitness',   name: 'Planet Fitness',       category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'other', countries: [...US_CA, ...OCEANIA], emoji: '🏋️', popularity: 60 },
  { id: 'la-fitness',       name: 'LA Fitness',           category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'other', countries: [...US_CA], emoji: '🏋️', popularity: 55 },
  { id: 'pure-gym',         name: 'PureGym',              category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'other', countries: [...UK_IRELAND], emoji: '🏋️', popularity: 60 },
  { id: 'virgin-active',    name: 'Virgin Active',        category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'other', countries: [...UK_IRELAND, ...SOUTHERN_AFR, ...OCEANIA, 'IT', 'SG', 'TH'], emoji: '🏋️', popularity: 60 },
  { id: 'classpass',        name: 'ClassPass',            category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'web', countries: ['global'], emoji: '🧘', popularity: 55 },
  { id: 'peloton-app',      name: 'Peloton App',          category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND, ...OCEANIA, ...EUROPE_WESTERN], emoji: '🚴', popularity: 60 },
  { id: 'strava-premium',   name: 'Strava Premium',       category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'web', countries: ['global'], emoji: '🏃', popularity: 65 },
  { id: 'apple-fitness-plus', name: 'Apple Fitness+',     category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'ios', countries: ['global'], emoji: '🍎', popularity: 60 },
  { id: 'nike-training-club', name: 'Nike Training Club', category: 'memberships', subCategory: 'Sports / Gym', defaultPlatform: 'web', countries: ['global'], emoji: '✔️', popularity: 50 },

  // Religious / spiritual community
  { id: 'youversion-plus',  name: 'YouVersion Premium',   category: 'memberships', subCategory: 'Religious / Spiritual community', defaultPlatform: 'web', countries: ['global'], emoji: '📖', popularity: 40 },

  // ── Education / Learning ───────────────────────────────────────────
  { id: 'coursera-plus',    name: 'Coursera Plus',        category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '🎓', popularity: 70 },
  { id: 'udemy',            name: 'Udemy',                category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '🎓', popularity: 70 },
  { id: 'masterclass',      name: 'MasterClass',          category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '🎬', popularity: 65 },
  { id: 'skillshare',       name: 'Skillshare',           category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '✏️', popularity: 55 },
  { id: 'linkedin-learning', name: 'LinkedIn Learning',   category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '💼', popularity: 60 },
  { id: 'codecademy-pro',   name: 'Codecademy Pro',       category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '👨‍💻', popularity: 55 },
  { id: 'pluralsight',      name: 'Pluralsight',          category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '🧑‍💻', popularity: 50 },
  { id: 'datacamp',         name: 'DataCamp',             category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '📊', popularity: 50 },
  { id: 'brilliant',        name: 'Brilliant',            category: 'education', subCategory: 'Online course subscriptions', defaultPlatform: 'web', countries: ['global'], emoji: '💡', popularity: 50 },
  { id: 'khan-academy-kids', name: 'Khan Academy Kids',   category: 'education', subCategory: 'Tutoring platforms', defaultPlatform: 'web', countries: ['global'], emoji: '🧒', popularity: 50 },
  { id: 'abcmouse',         name: 'ABCmouse',             category: 'education', subCategory: 'Tutoring platforms', defaultPlatform: 'web', countries: [...US_CA, ...UK_IRELAND, ...OCEANIA], emoji: '🐭', popularity: 45 },
  { id: 'iready',           name: 'i-Ready',              category: 'education', subCategory: 'Tutoring platforms', defaultPlatform: 'web', countries: [...US_CA], emoji: '📘', popularity: 40 },
  { id: 'kumon',            name: 'Kumon',                category: 'education', subCategory: 'Tutoring platforms', defaultPlatform: 'other', countries: ['global'], emoji: '📚', popularity: 60 },

  // ── Property / Land ─────────────────────────────────────────────────
  { id: 'annual-land-rent',      name: 'Annual Land Rent',         category: 'property_land', subCategory: 'Annual Land Rent', defaultPlatform: 'other', countries: ['global'], emoji: '🏞️', popularity: 70 },
  { id: 'property-tax',          name: 'Property Tax instalment',  category: 'property_land', subCategory: 'Property Tax instalments', defaultPlatform: 'other', countries: ['global'], emoji: '🏠', popularity: 60 },
  { id: 'hoa-fees',              name: 'HOA / Body Corporate Fees', category: 'property_land', subCategory: 'Body Corporate / HOA fees', defaultPlatform: 'other', countries: ['global'], emoji: '🏘️', popularity: 55 },
  { id: 'borehole-service',      name: 'Borehole Servicing',       category: 'property_land', subCategory: 'Borehole servicing', defaultPlatform: 'other', countries: [...AFRICA, ...INDIA_SUBCONT, ...MIDDLE_EAST], emoji: '🚰', popularity: 50 },

  // ── Vehicle ─────────────────────────────────────────────────────────
  { id: 'car-insurance-annual',  name: 'Car Insurance (annual)',   category: 'vehicle', subCategory: 'Insurance (annual)', defaultPlatform: 'other', countries: ['global'], emoji: '🚗', popularity: 90 },
  { id: 'road-licence',          name: 'Road Licence',             category: 'vehicle', subCategory: 'Road licence', defaultPlatform: 'other', countries: ['global'], emoji: '🪪', popularity: 75 },
  { id: 'cartrack',              name: 'Cartrack',                 category: 'vehicle', subCategory: 'Vehicle tracker', defaultPlatform: 'other', countries: [...SOUTHERN_AFR, ...EAST_AFRICA], emoji: '📍', popularity: 55 },
  { id: 'sentinel-tz',           name: 'Sentinel (Tanzania)',      category: 'vehicle', subCategory: 'Vehicle tracker', defaultPlatform: 'other', countries: ['TZ'], emoji: '📍', popularity: 50 },
  { id: 'tracker-sa',            name: 'Tracker SA',               category: 'vehicle', subCategory: 'Vehicle tracker', defaultPlatform: 'other', countries: [...SOUTHERN_AFR], emoji: '📍', popularity: 45 },

  // ── Utilities-as-subscription ───────────────────────────────────────
  { id: 'home-internet',         name: 'Home Internet',            category: 'utilities_sub', subCategory: 'Internet (subscription)', defaultPlatform: 'other', countries: ['global'], emoji: '📶', popularity: 90 },
  { id: 'starlink',              name: 'Starlink',                 category: 'utilities_sub', subCategory: 'Internet (subscription)', defaultPlatform: 'other', countries: ['global'], emoji: '🛰️', popularity: 65 },
  { id: 'safaricom-home-fibre',  name: 'Safaricom Home Fibre',     category: 'utilities_sub', subCategory: 'Internet (subscription)', defaultPlatform: 'other', countries: ['KE'], emoji: '🌐', popularity: 75 },
  { id: 'zuku-fibre',            name: 'Zuku Fibre',               category: 'utilities_sub', subCategory: 'Internet (subscription)', defaultPlatform: 'other', countries: [...EAST_AFRICA], emoji: '🌐', popularity: 60 },
  { id: 'liquid-home',           name: 'Liquid Home',              category: 'utilities_sub', subCategory: 'Internet (subscription)', defaultPlatform: 'other', countries: [...AFRICA], emoji: '🌐', popularity: 50 },
  { id: 'adt-security',          name: 'ADT Security',             category: 'utilities_sub', subCategory: 'Security monitoring', defaultPlatform: 'other', countries: [...US_CA, ...SOUTHERN_AFR, ...UK_IRELAND], emoji: '🚨', popularity: 60 },
  { id: 'ring-protect',          name: 'Ring Protect',             category: 'utilities_sub', subCategory: 'Security monitoring', defaultPlatform: 'web', countries: ['global'], emoji: '🔔', popularity: 60 },
  { id: 'simplisafe',            name: 'SimpliSafe',               category: 'utilities_sub', subCategory: 'Security monitoring', defaultPlatform: 'other', countries: [...US_CA, ...UK_IRELAND], emoji: '🏠', popularity: 50 },

] as const;

// ─────────────────────────────────────────────────────────────────────
// Global Contributions
// ─────────────────────────────────────────────────────────────────────

export const GLOBAL_CONTRIB_ITEMS: readonly GlobalContribItem[] = [

  // ── Charity & Humanitarian ─────────────────────────────────────────
  { id: 'red-cross',          recipientName: 'Red Cross',                          recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '➕', popularity: 100 },
  { id: 'unicef',             recipientName: 'UNICEF',                             recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '🧒', popularity: 95 },
  { id: 'save-the-children',  recipientName: 'Save the Children',                  recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '👶', popularity: 85 },
  { id: 'world-vision',       recipientName: 'World Vision',                       recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (recurring)', countries: ['global'], emoji: '🌍', popularity: 85 },
  { id: 'msf',                recipientName: 'Doctors Without Borders (MSF)',      recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '⚕️', popularity: 80 },
  { id: 'oxfam',              recipientName: 'Oxfam',                              recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '🌾', popularity: 75 },
  { id: 'care',               recipientName: 'CARE International',                 recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '🤝', popularity: 70 },
  { id: 'wfp',                recipientName: 'World Food Programme',               recipientType: 'organization', category: 'charity', subCategory: 'Disaster relief', countries: ['global'], emoji: '🍲', popularity: 75 },
  { id: 'unhcr',              recipientName: 'UNHCR',                              recipientType: 'organization', category: 'charity', subCategory: 'Disaster relief', countries: ['global'], emoji: '🛖', popularity: 65 },
  { id: 'habitat',            recipientName: 'Habitat for Humanity',               recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '🏠', popularity: 65 },
  { id: 'salvation-army',     recipientName: 'The Salvation Army',                 recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['global'], emoji: '🛎️', popularity: 70 },
  { id: 'childfund',          recipientName: 'ChildFund',                          recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (recurring)', countries: ['global'], emoji: '🧒', popularity: 55 },
  { id: 'plan-international', recipientName: 'Plan International',                 recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (recurring)', countries: ['global'], emoji: '🌐', popularity: 55 },
  { id: 'wwf',                recipientName: 'WWF (World Wildlife Fund)',          recipientType: 'organization', category: 'charity', subCategory: 'Animal welfare', countries: ['global'], emoji: '🐼', popularity: 70 },
  { id: 'greenpeace',         recipientName: 'Greenpeace',                         recipientType: 'organization', category: 'civic', subCategory: 'Environmental cause', countries: ['global'], emoji: '🌱', popularity: 60 },
  { id: 'amnesty',            recipientName: 'Amnesty International',              recipientType: 'organization', category: 'civic', subCategory: 'Advocacy / NGO', countries: ['global'], emoji: '🕊️', popularity: 55 },
  { id: 'global-fund',        recipientName: 'The Global Fund',                    recipientType: 'organization', category: 'charity', subCategory: 'Health / medical fund', countries: ['global'], emoji: '💊', popularity: 50 },

  // Africa-focused
  { id: 'amref',              recipientName: 'AMREF Health Africa',                recipientType: 'organization', category: 'charity', subCategory: 'Health / medical fund', countries: [...AFRICA], emoji: '🏥', popularity: 75 },
  { id: 'tanzania-red-cross', recipientName: 'Tanzania Red Cross',                 recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['TZ'], emoji: '➕', popularity: 85 },
  { id: 'kenya-red-cross',    recipientName: 'Kenya Red Cross',                    recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (one-off)', countries: ['KE'], emoji: '➕', popularity: 85 },
  { id: 'mkapa-foundation',   recipientName: 'Benjamin Mkapa Foundation',          recipientType: 'organization', category: 'charity', subCategory: 'Health / medical fund', countries: ['TZ'], emoji: '🏥', popularity: 55 },
  { id: 'aga-khan-dev-network', recipientName: 'Aga Khan Development Network',     recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (recurring)', countries: [...EAST_AFRICA, ...INDIA_SUBCONT], emoji: '🌍', popularity: 60 },
  { id: 'tunza-mama',         recipientName: 'Tunza Mama Tanzania',                recipientType: 'organization', category: 'charity', subCategory: 'Health / medical fund', countries: ['TZ'], emoji: '🤱', popularity: 50 },
  { id: 'msichana-initiative', recipientName: 'Msichana Initiative',               recipientType: 'organization', category: 'education_sponsorship', subCategory: 'Bursary / scholarship fund', countries: ['TZ'], emoji: '👧', popularity: 50 },
  { id: 'brac',               recipientName: 'BRAC',                               recipientType: 'organization', category: 'charity', subCategory: 'Registered charity (recurring)', countries: [...AFRICA, ...INDIA_SUBCONT], emoji: '🌍', popularity: 60 },

  // ── Faith & Religious (generic anchors — families add their own parish) ──
  { id: 'local-catholic-parish',  recipientName: 'Local Catholic Parish',         recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 90 },
  { id: 'local-protestant-church', recipientName: 'Local Protestant Church',      recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 85 },
  { id: 'local-lutheran-church',  recipientName: 'Local Lutheran Church',         recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 70 },
  { id: 'local-sda-church',       recipientName: 'Local SDA Church',              recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 65 },
  { id: 'local-pentecostal-church', recipientName: 'Local Pentecostal Church',    recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 70 },
  { id: 'local-anglican-church',  recipientName: 'Local Anglican Church',         recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 65 },
  { id: 'local-baptist-church',   recipientName: 'Local Baptist Church',          recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 65 },
  { id: 'local-methodist-church', recipientName: 'Local Methodist Church',        recipientType: 'community', category: 'faith', subCategory: 'Tithe', countries: ['global'], emoji: '⛪', popularity: 60 },
  { id: 'local-mosque',           recipientName: 'Local Mosque',                  recipientType: 'community', category: 'faith', subCategory: 'Other religious giving', countries: ['global'], emoji: '🕌', popularity: 80 },
  { id: 'zakat-foundation',       recipientName: 'Zakat Foundation',              recipientType: 'organization', category: 'faith', subCategory: 'Other religious giving', countries: ['global'], emoji: '🕌', popularity: 60 },
  { id: 'islamic-relief',         recipientName: 'Islamic Relief',                recipientType: 'organization', category: 'faith', subCategory: 'Mission support', countries: ['global'], emoji: '🕌', popularity: 65 },
  { id: 'jewish-federation',      recipientName: 'Local Jewish Federation',       recipientType: 'community', category: 'faith', subCategory: 'Other religious giving', countries: ['global'], emoji: '🕍', popularity: 50 },
  { id: 'local-hindu-temple',     recipientName: 'Local Hindu Temple',            recipientType: 'community', category: 'faith', subCategory: 'Other religious giving', countries: ['global'], emoji: '🛕', popularity: 60 },
  { id: 'pilgrimage-fund',        recipientName: 'Pilgrimage / Hajj Fund',        recipientType: 'cause', category: 'faith', subCategory: 'Pilgrimage / Hajj', countries: ['global'], emoji: '🕋', popularity: 55 },

  // ── Life Events (generic anchors) ───────────────────────────────────
  { id: 'wedding-contribution',   recipientName: 'Wedding contribution',          recipientType: 'person', category: 'life_events', subCategory: 'Wedding gift', countries: ['global'], emoji: '💍', popularity: 75 },
  { id: 'funeral-msiba',          recipientName: 'Funeral / Msiba',               recipientType: 'community', category: 'life_events', subCategory: 'Condolences / Funeral (msiba)', countries: ['global'], emoji: '🕯️', popularity: 80 },
  { id: 'baby-shower',            recipientName: 'Baby shower contribution',      recipientType: 'person', category: 'life_events', subCategory: 'Baby shower / new baby', countries: ['global'], emoji: '🍼', popularity: 50 },
  { id: 'graduation-gift',        recipientName: 'Graduation gift',               recipientType: 'person', category: 'life_events', subCategory: 'Graduation', countries: ['global'], emoji: '🎓', popularity: 50 },
  { id: 'birthday-gift',          recipientName: 'Birthday gift',                 recipientType: 'person', category: 'life_events', subCategory: 'Birthday gift', countries: ['global'], emoji: '🎂', popularity: 70 },
  { id: 'anniversary-gift',       recipientName: 'Anniversary gift',              recipientType: 'person', category: 'life_events', subCategory: 'Anniversary gift', countries: ['global'], emoji: '💐', popularity: 45 },
  { id: 'housewarming',           recipientName: 'Housewarming gift',             recipientType: 'person', category: 'life_events', subCategory: 'Housewarming', countries: ['global'], emoji: '🏡', popularity: 40 },
  { id: 'memorial-annual',        recipientName: 'Annual memorial',               recipientType: 'community', category: 'life_events', subCategory: 'Memorial / annual remembrance', countries: ['global'], emoji: '🕯️', popularity: 35 },

  // ── Family & Community ──────────────────────────────────────────────
  { id: 'family-support',         recipientName: 'Family member support',         recipientType: 'person', category: 'family_community', subCategory: 'Family member support', countries: ['global'], emoji: '👨‍👩‍👧', popularity: 90 },
  { id: 'extended-family',        recipientName: 'Extended family contribution',  recipientType: 'community', category: 'family_community', subCategory: 'Extended family contribution', countries: ['global'], emoji: '🌳', popularity: 80 },
  { id: 'neighbourhood-collection', recipientName: 'Neighbourhood collection (mchango)', recipientType: 'community', category: 'family_community', subCategory: 'Neighbourhood collection (mchango wa mtaa)', countries: [...EAST_AFRICA, ...AFRICA], emoji: '🏘️', popularity: 75 },
  { id: 'village-development',    recipientName: 'Village development fund',      recipientType: 'community', category: 'family_community', subCategory: 'Village development', countries: [...AFRICA, ...INDIA_SUBCONT], emoji: '🌾', popularity: 65 },
  { id: 'friend-in-need',         recipientName: 'Friend in need',                recipientType: 'person', category: 'family_community', subCategory: 'Friend in need (discreet)', countries: ['global'], emoji: '🤝', popularity: 60 },

  // ── Civic & Causes ──────────────────────────────────────────────────
  { id: 'gofundme',               recipientName: 'GoFundMe campaign',             recipientType: 'cause', category: 'civic', subCategory: 'Crowdfunding (GoFundMe, M-Changa)', countries: ['global'], emoji: '💸', popularity: 75 },
  { id: 'mchanga',                recipientName: 'M-Changa campaign',             recipientType: 'cause', category: 'civic', subCategory: 'Crowdfunding (GoFundMe, M-Changa)', countries: [...EAST_AFRICA], emoji: '💸', popularity: 70 },
  { id: 'kickstarter',            recipientName: 'Kickstarter campaign',          recipientType: 'cause', category: 'civic', subCategory: 'Crowdfunding (GoFundMe, M-Changa)', countries: ['global'], emoji: '🚀', popularity: 50 },

  // ── Education Sponsorship ───────────────────────────────────────────
  { id: 'sponsored-child-fees',   recipientName: 'Sponsored child — school fees', recipientType: 'person', category: 'education_sponsorship', subCategory: 'Sponsored child — school fees', countries: ['global'], emoji: '🎒', popularity: 65 },
  { id: 'sponsored-child-uniform', recipientName: 'Sponsored child — uniform & supplies', recipientType: 'person', category: 'education_sponsorship', subCategory: 'Sponsored child — uniform / supplies', countries: ['global'], emoji: '🎒', popularity: 55 },
  { id: 'bursary-fund',           recipientName: 'Bursary / scholarship fund',    recipientType: 'cause', category: 'education_sponsorship', subCategory: 'Bursary / scholarship fund', countries: ['global'], emoji: '🎓', popularity: 60 },

  // ── Workplace & Professional ────────────────────────────────────────
  { id: 'office-collection',      recipientName: 'Office collection',             recipientType: 'community', category: 'workplace', subCategory: 'Office collection', countries: ['global'], emoji: '🏢', popularity: 65 },
  { id: 'industry-association',   recipientName: 'Industry association dues',     recipientType: 'organization', category: 'workplace', subCategory: 'Industry association', countries: ['global'], emoji: '🤝', popularity: 50 },

] as const;
