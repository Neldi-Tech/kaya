import admin from 'firebase-admin'; import fs from 'node:fs';
const sa = JSON.parse(fs.readFileSync(process.env.HOME + '/.config/firebase/kaya-sa.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
(async () => {
  const fam = db.collection('families').doc(process.env.FAMILY_ID!);
  const hs = await fam.collection('helpers').get();
  for (const h of hs.docs) {
    const snaps = await h.ref.collection('perfWeeks').get();
    console.log((h.data().displayName as string).padEnd(10), snaps.docs.map(d => `${d.id}:${d.data().score}`).join(' '));
  }
  process.exit(0);
})();
