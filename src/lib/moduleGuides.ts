// Kaya Module Guides — the data + tiny launcher behind the in-app "how it
// works" guides. A guide plays like a short video (auto-advancing scenes with
// optional voiceover) but is built from the live app, so it never goes stale.
//
// Fully bilingual: scene copy + titles + blurbs are Localized (see lib/i18n);
// the player resolves them with useLocale() and falls back to English. Scene
// VISUAL micro-labels (flow/grid chips) stay English in v1 — the narration +
// captions + chrome carry the language.
//
// Homes (all powered by this one registry):
//   • KayaGuide FAB  → "▶ Show me how this works" for the current screen
//   • Videos module  → the browseable "Guides & Videos" library
//   • A ▶ pill on each module page
// Launch from anywhere with openModuleGuide(moduleId); GuideHost (mounted in
// the app layout) listens and renders the player.

import type { Localized } from './i18n';

export type GuideSceneVisual =
  | { kind: 'hero'; emoji: string }
  | { kind: 'flow'; steps: { emoji: string; label: string }[] }
  | { kind: 'grid'; items: { emoji: string; label: string }[] }
  | { kind: 'pair'; items: { emoji: string; label: string; sub: string }[] }
  | { kind: 'budget'; label: string; pct: number; note: string }
  | { kind: 'screen'; screen: 'purchases'; highlight: 'new' | 'basket' | 'submit' | 'pending' | 'reconcile' };

export interface GuideScene {
  visual: GuideSceneVisual;
  title: Localized;
  body: Localized;
  /** Optional role-aware override shown to helpers instead of `body`. */
  bodyHelper?: Localized;
}

export interface ModuleGuide {
  id: string;
  title: Localized;
  emoji: string;
  blurb: Localized;
  paths: string[];
  ctaLabel?: Localized;
  ctaHref?: string;
  scenes: GuideScene[];
  available: boolean;
  deeperGuideId?: string;
  parentId?: string;
}

// ── Household ──────────────────────────────────────────────────────────────
const HOUSEHOLD_GUIDE: ModuleGuide = {
  id: 'household',
  title: { en: 'Household', sw: 'Household' },
  emoji: '🏡',
  blurb: { en: 'Your family’s money out — log, approve, reconcile.', sw: 'Pesa za nyumbani — andika, idhinisha, linganisha.' },
  paths: ['/household', '/pantry'],
  ctaLabel: { en: 'Open Purchases', sw: 'Fungua Purchases' },
  ctaHref: '/pantry/purchase',
  available: true,
  deeperGuideId: 'purchases',
  scenes: [
    {
      visual: { kind: 'hero', emoji: '🏡' },
      title: { en: 'Welcome to Household', sw: 'Karibu kwenye Household' },
      body: {
        en: 'This is where your family’s money out lives — calm, in one place. Every shilling that leaves the home, tracked.',
        sw: 'Hapa ndipo matumizi yote ya familia yako hukaa — kwa utulivu, sehemu moja. Kila shilingi inayotoka nyumbani, hufuatiliwa.',
      },
    },
    {
      visual: { kind: 'flow', steps: [{ emoji: '✍️', label: 'Log' }, { emoji: '✅', label: 'Approve' }, { emoji: '📊', label: 'Done' }] },
      title: { en: 'One simple loop', sw: 'Mzunguko mmoja rahisi' },
      body: {
        en: 'Someone logs a spend, a parent taps yes, and it’s reconciled against your budget. Log, approve, done.',
        sw: 'Mtu huandika matumizi, mzazi hubonyeza ndiyo, na yanalinganishwa na bajeti yenu. Andika, idhinisha, imekwisha.',
      },
      bodyHelper: {
        en: 'You log a spend within your scope, a parent approves it, and it’s reconciled against the budget. Log, approve, done.',
        sw: 'Wewe huandika matumizi ndani ya mipaka yako, mzazi huidhinisha, na yanalinganishwa na bajeti. Andika, idhinisha, imekwisha.',
      },
    },
    {
      visual: { kind: 'grid', items: [
        { emoji: '🧾', label: 'Purchases' }, { emoji: '⚡', label: 'Utilities' }, { emoji: '🌿', label: 'Outdoor' },
        { emoji: '🚗', label: 'Drivers' }, { emoji: '🍽️', label: 'Dine Out' }, { emoji: '🛋️', label: 'Home' },
      ] },
      title: { en: 'Everyday spending', sw: 'Matumizi ya kila siku' },
      body: {
        en: 'Groceries, power and water, the garden, the car, eating out, the home itself — each has its own tidy place.',
        sw: 'Vyakula, umeme na maji, bustani, gari, kula nje, na nyumba yenyewe — kila kimoja kina sehemu yake nadhifu.',
      },
    },
    {
      visual: { kind: 'pair', items: [
        { emoji: '🤝', label: 'Payroll', sub: 'Helpers request privately' },
        { emoji: '🤲', label: 'Contributions', sub: 'Gifts · tithe · msiba' },
      ] },
      title: { en: 'People & giving', sw: 'Watu na utoaji' },
      body: {
        en: 'Payroll lets each helper request their own advance, privately. Contributions tracks gifts, tithe, msiba and charity.',
        sw: 'Payroll huruhusu kila msaidizi kuomba malipo yake ya awali, kwa faragha. Contributions hufuatilia zawadi, sadaka, misiba na hisani.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🔁' },
      title: { en: 'Recurring, handled', sw: 'Za kujirudia, zimepangwa' },
      body: {
        en: 'Subscriptions remembers every repeating bill — apps, memberships, property dues — so you never miss or overpay one.',
        sw: 'Subscriptions hukumbuka kila bili inayojirudia — programu, uanachama, ada za mali — ili usisahau wala kulipa zaidi.',
      },
    },
    {
      visual: { kind: 'budget', label: 'This month’s budget', pct: 62, note: 'on track ✅' },
      title: { en: 'Stay on budget', sw: 'Baki kwenye bajeti' },
      body: {
        en: 'Finances shows what’s left this month at a glance, so the family always knows if you’re on track.',
        sw: 'Finances huonyesha kilichobaki mwezi huu kwa haraka, ili familia ijue daima kama mko kwenye mstari.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎉' },
      title: { en: 'You’re ready!', sw: 'Uko tayari!' },
      body: {
        en: 'Best first step — open Purchases and log one thing you bought today. You’ll feel the loop in ten seconds.',
        sw: 'Hatua bora ya kwanza — fungua Purchases na uandike kitu kimoja ulichonunua leo. Utahisi mzunguko ndani ya sekunde kumi.',
      },
    },
  ],
};

// ── Purchases · "how it flows" (deep walk-through of the request loop) ───────
const PURCHASES_FLOW: ModuleGuide = {
  id: 'purchases',
  title: { en: 'Purchases — how it flows', sw: 'Purchases — jinsi inavyofanya kazi' },
  emoji: '🧾',
  blurb: { en: 'The full request loop, step by step.', sw: 'Mzunguko kamili wa ombi, hatua kwa hatua.' },
  paths: ['/pantry/purchase'],
  parentId: 'household',
  ctaLabel: { en: 'Open Purchases', sw: 'Fungua Purchases' },
  ctaHref: '/pantry/purchase',
  available: true,
  scenes: [
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'new' },
      title: { en: 'Start a shop run', sw: 'Anza ununuzi' },
      body: {
        en: 'Tap ＋ New request. Kaya opens a fresh draft and names it for you, like PAN-1042.',
        sw: 'Bonyeza ＋ New request. Kaya hufungua rasimu mpya na kuipa jina, kama PAN-1042.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'basket' },
      title: { en: 'Add what you’re buying', sw: 'Ongeza unachonunua' },
      body: {
        en: 'List each item and its amount. Re-buy your regulars in one tap with Recycle.',
        sw: 'Orodhesha kila kitu na kiasi chake. Nunua tena vitu vya kawaida kwa mbonyezo mmoja kwa Recycle.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'submit' },
      title: { en: 'Send it for approval', sw: 'Tuma kwa idhini' },
      body: {
        en: 'Done shopping? Submit. The total locks in your currency and it heads off.',
        sw: 'Umemaliza kununua? Tuma. Jumla hufungwa kwa sarafu yako na huondoka.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'pending' },
      title: { en: 'Approval', sw: 'Idhini' },
      body: {
        en: 'It lands in your Approvals as pending — tap approve, or reject with a note.',
        sw: 'Inafika kwenye Approvals zako ikiwa inasubiri — bonyeza idhinisha, au kataa kwa maelezo.',
      },
      bodyHelper: {
        en: 'It goes to a parent’s Approvals — they approve or reject, and you get notified.',
        sw: 'Inakwenda kwenye Approvals za mzazi — yeye huidhinisha au kukataa, nawe hupewa taarifa.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'reconcile' },
      title: { en: 'Reconcile & close', sw: 'Linganisha na funga' },
      body: {
        en: 'Once approved, reconcile it against the budget before the timer ends. That’s the full loop! 🎉',
        sw: 'Baada ya kuidhinishwa, linganisha na bajeti kabla ya muda kuisha. Huo ndio mzunguko kamili! 🎉',
      },
    },
  ],
};

// ── Kaya Quests ────────────────────────────────────────────────────────────
// The instruction manual for the Quests area. Elia asked for this on
// 2026-08-15 — the pieces were on screen but nothing explained the ORDER
// they go in, which is the part that actually confuses a new parent:
// goal → library → approve → schedule → one a day → measure → graduate.
const QUESTS_GUIDE: ModuleGuide = {
  id: 'quests',
  title: { en: 'Kaya Quests', sw: 'Kaya Quests' },
  emoji: '🚀',
  blurb: {
    en: 'Pick a goal, and Kaya turns it into one small activity a day — with proof you can hear months later.',
    sw: 'Chagua lengo, na Kaya hulibadilisha kuwa zoezi dogo moja kwa siku — na ushahidi utakaosikika miezi baadaye.',
  },
  paths: ['/sparks'],
  ctaLabel: { en: 'Open Sparks', sw: 'Fungua Sparks' },
  ctaHref: '/sparks',
  available: true,
  scenes: [
    {
      visual: { kind: 'hero', emoji: '🚀' },
      title: { en: 'What a Quest is', sw: 'Quest ni nini' },
      body: {
        en: 'A Quest is one thing you want your child to get better at — speaking clearly, reading aloud, times tables, a sport. You set the goal. Kaya turns it into one small activity a day, and keeps the proof so you can both hear the difference later.',
        sw: 'Quest ni jambo moja unalotaka mtoto wako aboreshe — kuzungumza kwa uwazi, kusoma kwa sauti, hesabu, au mchezo. Wewe unaweka lengo. Kaya hulibadilisha kuwa zoezi dogo moja kwa siku, na huhifadhi ushahidi ili nyote muweze kusikia tofauti baadaye.',
      },
    },
    {
      visual: {
        kind: 'flow',
        steps: [
          { emoji: '🎯', label: 'Goal' },
          { emoji: '📚', label: 'Library' },
          { emoji: '✅', label: 'Allow' },
          { emoji: '📅', label: 'Schedule' },
          { emoji: '🚀', label: 'One a day' },
        ],
      },
      title: { en: 'The order it goes in', sw: 'Mpangilio wake' },
      body: {
        en: 'This is the whole thing. Set the goal, let Kaya fill the Library with activities, tick the ones you allow, schedule them onto the days — then your child simply opens the app and finds today’s.',
        sw: 'Huu ndio mzunguko mzima. Weka lengo, acha Kaya ijaze Maktaba na mazoezi, chagua unayoyaruhusu, yapange kwenye siku — kisha mtoto wako hufungua app na kukuta la leo.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎯' },
      title: { en: '1 · Start with the goal, not the problem', sw: '1 · Anza na lengo, si tatizo' },
      body: {
        en: 'Kaya asks where you want your child to GET TO — “tell a 2-minute story without freezing”. Your child reads that, so write it the way you’d say it to them. The honest starting point is asked separately and stays parents-only: your child never sees it, and Kaya never repeats it back to them.',
        sw: 'Kaya huuliza unataka mtoto wako AFIKE wapi — “kusimulia hadithi ya dakika 2 bila kuganda”. Mtoto wako husoma hilo, hivyo liandike jinsi ungemwambia. Hali halisi ya mwanzo huulizwa peke yake na hubaki kwa wazazi tu: mtoto wako haioni kamwe, na Kaya hairudii kwake.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎬' },
      title: { en: '2 · Capture the starting line', sw: '2 · Nasa mstari wa kuanzia' },
      body: {
        en: 'Before any practice, record each marker once. That first reading is the BASELINE — the line everything later is measured against. Attach audio or video if you can: in a few weeks your child plays it back, and that is the moment the whole thing pays off. It can only be captured at the start.',
        sw: 'Kabla ya mazoezi yoyote, rekodi kila kipimo mara moja. Usomaji huo wa kwanza ndio MSINGI — mstari ambao kila kitu kinachofuata hupimwa dhidi yake. Ambatisha sauti au video ikiwezekana: baada ya wiki chache mtoto wako huisikiliza, na huo ndio wakati kila kitu hulipa. Unaweza kunaswa mwanzoni tu.',
      },
    },
    {
      visual: {
        kind: 'grid',
        items: [
          { emoji: '👀', label: 'To review' },
          { emoji: '✅', label: 'Ready' },
          { emoji: '📅', label: 'Scheduled' },
        ],
      },
      title: { en: '3 · The Library — three piles', sw: '3 · Maktaba — marundo matatu' },
      body: {
        en: 'Tap Generate and Kaya writes a week (or two) of daily activities — deliberately different kinds, not the same drill reworded. They land in To review, where your child cannot see them. Tick what you allow, discard or edit the rest, add your own. Then Schedule: approved activities go onto the days, one a day.',
        sw: 'Bonyeza Generate na Kaya huandika mazoezi ya wiki moja (au mbili) — ya aina tofauti kwa makusudi, si zoezi lilelile likiandikwa upya. Huingia kwenye To review, ambapo mtoto wako hawezi kuyaona. Chagua unayoruhusu, tupa au hariri mengine, ongeza yako. Kisha Schedule: mazoezi yaliyoidhinishwa huenda kwenye siku, moja kwa siku.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🔒' },
      title: { en: '4 · Your child gets today only', sw: '4 · Mtoto wako hupata la leo tu' },
      body: {
        en: 'They open the app and find one activity: today’s. They can see what is coming next, but they cannot do it early — the rhythm is the point. Nothing you have not ticked ever reaches them.',
        sw: 'Hufungua app na kukuta zoezi moja: la leo. Wanaweza kuona linalofuata, lakini hawawezi kulifanya mapema — mdundo ndio lengo. Chochote ambacho hujakidhinisha hakiwafikii kamwe.',
      },
    },
    {
      visual: {
        kind: 'pair',
        items: [
          { emoji: '🔥', label: 'Consistency', sub: 'Did they show up' },
          { emoji: '📈', label: 'Growth', sub: 'Did they get better' },
        ],
      },
      title: { en: '5 · Two different questions', sw: '5 · Maswali mawili tofauti' },
      body: {
        en: 'The streak answers whether they showed up. The markers answer whether they got better. Kaya keeps them apart on purpose, because a single blended score can be pushed up by obedience alone. Streaks are kind too — rest days never count, a shield absorbs a missed day, and there is a one-time repair.',
        sw: 'Mfululizo hujibu kama walijitokeza. Vipimo hujibu kama waliboreka. Kaya huvitenganisha kwa makusudi, kwa sababu alama moja iliyochanganywa inaweza kupandishwa kwa utii pekee. Mifululizo pia ni ya huruma — siku za mapumziko hazihesabiwi, ngao huchukua siku iliyokoswa, na kuna urekebishaji wa mara moja.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🔔' },
      title: { en: '6 · Nobody has to remember', sw: '6 · Hakuna anayepaswa kukumbuka' },
      body: {
        en: 'Each quest has a cut-off time. An hour before it, your child gets a gentle nudge — never an email. If the activity is still open at the cut-off, you get the email, along with anyone extra you added: a tutor, a grandparent. If they do it later that evening, you get a quiet tick and no second email.',
        sw: 'Kila quest ina muda wa mwisho. Saa moja kabla yake, mtoto wako hupata kumbusho la upole — kamwe si barua pepe. Kama zoezi bado liko wazi wakati wa mwisho, wewe hupata barua pepe, pamoja na yeyote uliyemwongeza: mwalimu, babu au bibi. Wakilifanya jioni hiyo, hupata alama ya kimya bila barua pepe ya pili.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎓' },
      title: { en: '7 · Graduation', sw: '7 · Kuhitimu' },
      body: {
        en: 'When the goal is reached, graduate the quest. Your child gets the points and a certificate, and the quest becomes a permanent Achievement in Sparks — carrying the recording from day one next to the one from today. That side-by-side is the thing you will still be showing people years from now.',
        sw: 'Lengo likifikiwa, hitimisha quest. Mtoto wako hupata pointi na cheti, na quest huwa Mafanikio ya kudumu ndani ya Sparks — ikiwa na rekodi ya siku ya kwanza kando ya ya leo. Mlinganisho huo ndio utakaowaonyesha watu miaka mingi ijayo.',
      },
    },
  ],
};

// ── Treasures ──────────────────────────────────────────────────────────────
// The pieces on screen never explain the ORDER they go in, which is the part
// that actually confuses a new family. Swahili needs a native review pass like
// the other guides.
const TREASURES_GUIDE: ModuleGuide = {
  id: 'treasures',
  title: { en: 'Kaya Treasures', sw: 'Kaya Treasures' },
  emoji: '💎',
  blurb: {
    en: 'Every gift and every thing they own, on a register — who gave it, and a 30-second check so nothing gets lost.',
    sw: 'Kila zawadi na kila kitu wanachomiliki, kwenye daftari — nani alitoa, na ukaguzi wa sekunde 30 ili kisipotee.',
  },
  paths: ['/sparks'],
  ctaLabel: { en: 'Open Sparks', sw: 'Fungua Sparks' },
  ctaHref: '/sparks',
  available: true,
  scenes: [
    {
      visual: { kind: 'hero', emoji: '💎' },
      title: { en: 'What Treasures is for', sw: 'Treasures ni ya nini' },
      body: {
        en: 'It looks like a list of things. It isn’t. It’s a child who knows where their things are, remembers who loved them enough to give them, and understands what those things cost. The register is just how we get there.',
        sw: 'Inaonekana kama orodha ya vitu. Sivyo. Ni mtoto anayejua vitu vyake vilipo, anayekumbuka nani aliyempenda kiasi cha kumpa, na anayeelewa vitu hivyo viligharimu nini. Daftari ni njia tu ya kufika huko.',
      },
    },
    {
      visual: {
        kind: 'flow',
        steps: [
          { emoji: '🎁', label: 'Register' },
          { emoji: '💛', label: 'Who gave it' },
          { emoji: '🔑', label: 'Check' },
          { emoji: '🔍', label: 'Find' },
          { emoji: '🤝', label: 'Hand on' },
        ],
      },
      title: { en: 'The order it goes in', sw: 'Mpangilio wake' },
      body: {
        en: 'Add a thing with a photo and a name. Say who gave it. Every so often your child taps once per thing to say they still have it. Anything missing goes on the family board. And when they outgrow it, it gets a proper ending instead of just disappearing.',
        sw: 'Ongeza kitu kwa picha na jina. Sema nani alitoa. Mara kwa mara mtoto wako hugusa mara moja kwa kila kitu kusema bado anacho. Kilichopotea huenda kwenye ubao wa familia. Na anapokikua, kinapata mwisho mzuri badala ya kutoweka tu.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎁' },
      title: { en: '1 · A photo and a name is enough', sw: '1 · Picha na jina yatosha' },
      body: {
        en: 'Don’t try to register everything — that’s how this dies in week one. Start with the ten things your child would be saddest to lose. Who gave it and why it matters can be filled in any time; a half-registered thing beats an unregistered one.',
        sw: 'Usijaribu kusajili kila kitu — hivyo ndivyo hii hufa wiki ya kwanza. Anza na vitu kumi ambavyo mtoto wako angehuzunika zaidi kuvipoteza. Nani alitoa na kwa nini ni muhimu vinaweza kujazwa wakati wowote.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '💛' },
      title: { en: '2 · Who gave it is the point', sw: '2 · Nani alitoa ndilo jambo' },
      body: {
        en: 'Every treasure remembers the person it came from. Your child can record a thank-you — you read it and send it, never them — and whatever the giver says back is pinned to that object forever. Years later the watch still carries Grandma’s voice.',
        sw: 'Kila hazina hukumbuka mtu iliyotoka kwake. Mtoto wako anaweza kurekodi shukrani — wewe unaisoma na kuituma, si yeye — na chochote mtoaji anachojibu hubandikwa kwenye kitu hicho milele.',
      },
    },
    {
      visual: {
        kind: 'grid',
        items: [
          { emoji: '✅', label: 'Got it' },
          { emoji: '🔧', label: 'Needs fixing' },
          { emoji: '❓', label: 'Can’t find it' },
        ],
      },
      title: { en: '3 · The Keeper Check', sw: '3 · Ukaguzi wa Mlinzi' },
      body: {
        en: 'The engine of the whole thing. On the rhythm you set — weekly, twice a month, monthly or once a term — your child taps once per thing. Thirty seconds. It shows up on My Day and the Workplan so nobody has to remember it, and if it slips, Kaya tells you before it becomes a habit.',
        sw: 'Injini ya kila kitu. Kwa mdundo unaouweka — kila wiki, mara mbili kwa mwezi, kila mwezi au mara moja kwa muhula — mtoto wako hugusa mara moja kwa kila kitu. Sekunde thelathini.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🫱' },
      title: { en: '4 · Never punish an accident', sw: '4 · Usiadhibu ajali' },
      body: {
        en: 'This is the rule that decides whether the register is true or fiction. A child who fears trouble hides a broken strap. So reporting it yourself EARNS something — 🫱 Owned It — and nothing is ever taken away for the accident itself. Please say it out loud to them too.',
        sw: 'Hii ndiyo sheria inayoamua kama daftari ni la kweli au uongo. Mtoto anayeogopa shida huficha mkanda uliovunjika. Hivyo kuripoti mwenyewe HUPATA kitu — 🫱 Owned It — na hakuna kinachoondolewa kwa ajali yenyewe.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '⚖️' },
      title: { en: '5 · What things cost, in their money', sw: '5 · Vitu vinagharimu nini, kwa pesa zao' },
      body: {
        en: 'You record what something cost; your child never sees that number. What they see is the same value in the effort it took them — “about six weeks of chores”. A nine-year-old can act on that sentence and cannot act on a price tag.',
        sw: 'Wewe unarekodi kitu kiligharimu nini; mtoto wako haoni namba hiyo kamwe. Anachokiona ni thamani ile ile kwa juhudi ilizochukua — “kama wiki sita za kazi za nyumbani”.',
      },
    },
    {
      visual: {
        kind: 'grid',
        items: [
          { emoji: '🔍', label: 'Lost & Found' },
          { emoji: '🤝', label: 'Borrow' },
          { emoji: '✨', label: 'Wish Shelf' },
          { emoji: '🕰', label: 'Memory Shelf' },
        ],
      },
      title: { en: '6 · The four rails', sw: '6 · Reli nne' },
      body: {
        en: 'Lost & Found asks WHERE something was last seen — never who took it. Borrow & Return chases the thing your child lent and forgot, which is how most things actually vanish. The Wish Shelf feeds your Gift Brain before birthdays. And nothing is ever deleted — it moves to the Memory Shelf with its whole story.',
        sw: 'Lost & Found huuliza kitu kilionekana WAPI mwisho — si nani alichukua. Borrow & Return hufuatilia kitu mtoto wako alichoazima na kusahau. Wish Shelf hulisha Gift Brain kabla ya siku za kuzaliwa. Na hakuna kinachofutwa kamwe.',
      },
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// `available: false` entries appear in the library as "Coming soon".
export const MODULE_GUIDES: ModuleGuide[] = [
  HOUSEHOLD_GUIDE,
  PURCHASES_FLOW,
  QUESTS_GUIDE,
  TREASURES_GUIDE,
  { id: 'hive', title: { en: 'The Hive' }, emoji: '🐝', blurb: { en: 'Points → Honey → real cash.' }, paths: ['/hive'], scenes: [], available: false },
  { id: 'games', title: { en: 'Kaya Games' }, emoji: '🎮', blurb: { en: 'Play, earn House Points, stay safe.' }, paths: ['/games'], scenes: [], available: false },
  { id: 'wealth', title: { en: 'Kaya Wealth' }, emoji: '💎', blurb: { en: 'The family vault & investments.' }, paths: ['/wealth'], scenes: [], available: false },
];

export function getGuide(id: string | null | undefined): ModuleGuide | undefined {
  if (!id) return undefined;
  return MODULE_GUIDES.find((g) => g.id === id);
}

/** The guide whose module owns this route (for the FAB's contextual offer).
 *  Prefers the MOST specific match, so /pantry/purchase offers the Purchases
 *  flow rather than the broader Household overview. */
export function guideForPath(pathname: string | null | undefined): ModuleGuide | undefined {
  if (!pathname) return undefined;
  let best: ModuleGuide | undefined;
  let bestLen = -1;
  for (const g of MODULE_GUIDES) {
    if (!g.available) continue;
    for (const p of g.paths) {
      if ((pathname === p || pathname.startsWith(p + '/')) && p.length > bestLen) { best = g; bestLen = p.length; }
    }
  }
  return best;
}

export const GUIDE_EVENT = 'kaya:open-guide';

/** Open a module guide from anywhere (the GuideHost in the app layout listens). */
export function openModuleGuide(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: { id } }));
}

// ── Watched state (Phase 1: local to the device; Firestore sync is a
//    fast-follow so the ✓ travels across devices) ──────────────────────────
const WATCHED_KEY = 'kaya:guidesWatched';
export function markGuideWatched(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const set = new Set<string>(JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]'));
    set.add(id);
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...set]));
  } catch { /* storage blocked — watched state is non-critical */ }
}
export function isGuideWatched(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]') as string[]).includes(id);
  } catch { return false; }
}
