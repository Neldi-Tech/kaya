// HP2 QA — run the real weekly compute against prod Firestore (Admin SA), dry (no store) unless STORE=1.
import admin from 'firebase-admin';
import fs from 'node:fs';
import { readPolicy, isTracked, helperLiteFrom, settledWeeks, weekBounds, computeHelperWeek, getOrComputeWeek, shareText } from '../src/lib/helperPerf.server';
import { ymdLocal } from '../src/lib/routineFillCore';

const sa = JSON.parse(fs.readFileSync(process.env.HOME + '/.config/firebase/kaya-sa.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const famId = process.env.FAMILY_ID!;
const famRef = db.collection('families').doc(famId);
(async () => {
  const policy = await readPolicy(famRef);
  console.log('policy weights', policy.weights, 'tracked overrides', Object.entries(policy.helperOverrides).map(([k,v])=>[k.slice(0,6), v.tracked, v.kidsReview]));
  const helpers = (await famRef.collection('helpers').get()).docs.map(d => helperLiteFrom(d.id, d.data() as Record<string, unknown>)).filter(h => h.status !== 'removed');
  const today = ymdLocal(new Date());
  const weeks = settledWeeks(today, 3);
  const cur = weekBounds(today);
  for (const h of helpers) {
    const tracked = isTracked(policy, h.uid);
    console.log(`\n== ${h.displayName} (${h.preset}) kids=${h.kidIds.length} freq=${h.expectedFrequency} workDays=${h.workDays?.join(',') ?? 'all'} joined=${h.joinedDate} tracked=${tracked}`);
    const c = await computeHelperWeek(db as any, famRef as any, h, policy, cur.from, cur.to, today);
    console.log(`  current ${c.weekKey} score=${c.score} ${c.face.emoji} fill=${c.fill.codes} ${c.fill.pct}% wp=${c.metrics.workplan.pct} (${c.metrics.workplan.done}/${c.metrics.workplan.scheduled}) rat=${c.metrics.ratingCompletion.pct} (${c.metrics.ratingCompletion.logged}/${c.metrics.ratingCompletion.expected}) bud=${c.metrics.budget.pct} fb=${c.metrics.parentFeedback.pct} kid=${c.metrics.kidReview.pct}`);
    for (const w of weeks) {
      const s = process.env.STORE === '1' && tracked
        ? await getOrComputeWeek(db as any, famRef as any, h, policy, w, today)
        : await computeHelperWeek(db as any, famRef as any, h, policy, w.from, w.to, today);
      console.log(`  ${s.weekKey} score=${s.score} ${s.face.emoji} fill=${s.fill.codes} ${s.fill.pct}% wp=${s.metrics.workplan.pct} rat=${s.metrics.ratingCompletion.pct} (${s.metrics.ratingCompletion.logged}/${s.metrics.ratingCompletion.expected}) bud=${s.metrics.budget.pct} fb=${s.metrics.parentFeedback.pct}`);
    }
    if (process.env.SHARE === '1') console.log(shareText(h.displayName, c, null));
  }
  process.exit(0);
})();
