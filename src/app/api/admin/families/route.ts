// GET /api/admin/families — operator-only. Lists every family in the
// project with the operational fields the /admin/families page needs:
// tier, addons, founding flag, member counts.
//
// Member counts are derived from the existing /users/* collection
// (filtered by familyId) so we don't keep a denormalised "memberCount"
// on the family doc. For closed beta (handful of families) this is
// cheap; revisit if we ever cross a few hundred families.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface AdminFamilyRow {
  id: string;
  name: string;
  handle: string | null;
  tierId: 'nest' | 'home' | 'castle';
  addons: string[];
  isFoundingFamily: boolean;
  createdAtMs: number;
  /** Max lastActiveAt across the family's users (presence heartbeat), in
   *  epoch ms; 0 if no member has been active since presence shipped. */
  lastActiveAtMs: number;
  members: {
    parents: number;
    helpers: number;
    kids: number;
    guests: number;
  };
  storage: {
    bytes: number;
    extraGB: number;
    recountedAtMs: number;
  };
}

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db } = r;

  const famSnap = await db.collection('families').orderBy('name').get();
  const rows: AdminFamilyRow[] = [];

  // One users fetch per family — heavy at scale but fine in closed beta.
  // From those docs we derive role counts + the family's most-recent
  // lastActiveAt (presence heartbeat). Revisit past a few hundred families.
  for (const fam of famSnap.docs) {
    const data = fam.data() as {
      name?: string;
      handle?: string;
      tierId?: 'nest' | 'home' | 'castle';
      subscription?: { addons?: string[] };
      isFoundingFamily?: boolean;
      createdAt?: FirebaseFirestore.Timestamp;
      storage?: { bytes?: number; extraGB?: number; recountedAt?: FirebaseFirestore.Timestamp };
    };

    // One fetch per family: derive role counts AND the max lastActiveAt
    // (presence heartbeat) in memory. A single equality filter on familyId
    // needs no composite index.
    const usersSnap = await db.collection('users').where('familyId', '==', fam.id).get();
    let parents = 0, helpers = 0, kids = 0, guests = 0;
    let lastActiveAtMs = 0;
    for (const u of usersSnap.docs) {
      const ud = u.data() as { role?: string; lastActiveAt?: { toMillis?: () => number } };
      if (ud.role === 'parent') parents++;
      else if (ud.role === 'helper') helpers++;
      else if (ud.role === 'kid') kids++;
      else if (ud.role === 'guest') guests++;
      if (ud.lastActiveAt && typeof ud.lastActiveAt.toMillis === 'function') {
        const msv = ud.lastActiveAt.toMillis();
        if (msv > lastActiveAtMs) lastActiveAtMs = msv;
      }
    }

    rows.push({
      id: fam.id,
      name: data.name ?? '(unnamed)',
      handle: data.handle ?? null,
      tierId: data.tierId ?? 'nest',
      addons: data.subscription?.addons ?? [],
      isFoundingFamily: data.isFoundingFamily === true,
      createdAtMs: data.createdAt && typeof (data.createdAt as { toMillis?: () => number }).toMillis === 'function'
        ? (data.createdAt as { toMillis: () => number }).toMillis()
        : 0,
      lastActiveAtMs,
      members: { parents, helpers, kids, guests },
      storage: {
        bytes: data.storage?.bytes ?? 0,
        extraGB: data.storage?.extraGB ?? 0,
        recountedAtMs: data.storage?.recountedAt && typeof (data.storage.recountedAt as { toMillis?: () => number }).toMillis === 'function'
          ? (data.storage.recountedAt as { toMillis: () => number }).toMillis()
          : 0,
      },
    });
  }

  return NextResponse.json({ families: rows });
}
