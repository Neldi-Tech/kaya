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

  // One users-query per family is heavy at scale but fine in closed beta.
  // We use the lighter `count()` aggregate per role to keep payloads tiny.
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

    const roles: Array<'parent' | 'helper' | 'kid' | 'guest'> = ['parent', 'helper', 'kid', 'guest'];
    const counts = await Promise.all(roles.map(async (role) => {
      const q = db.collection('users')
        .where('familyId', '==', fam.id)
        .where('role', '==', role);
      const agg = await q.count().get();
      return agg.data().count;
    }));

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
      members: { parents: counts[0], helpers: counts[1], kids: counts[2], guests: counts[3] },
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
