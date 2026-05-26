'use client';

import { useState } from 'react';
import { categoryEmoji, categoryLabel, type SparkCategory } from '@/lib/sparks';
import { createSpark } from '@/lib/sparksClient';

const CATS: SparkCategory[] = ['idea', 'bug', 'help', 'story'];

export function Composer({
  familyDisplayName,
  initials,
  defaultAnonymous,
  storiesEnabled,
  onPosted,
}: {
  familyDisplayName: string;
  initials: string;
  defaultAnonymous: boolean;
  storiesEnabled: boolean;
  onPosted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<SparkCategory>('idea');
  const [anonymous, setAnonymous] = useState(defaultAnonymous);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cats = storiesEnabled ? CATS : CATS.filter((c) => c !== 'story');

  async function submit() {
    setErr(null);
    if (!title.trim() || !body.trim()) {
      setErr('Add a title and a description.');
      return;
    }
    setBusy(true);
    try {
      await createSpark({ title: title.trim(), body: body.trim(), category, postedAnonymously: anonymous });
      setTitle(''); setBody('');
      onPosted();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-[20px] p-[18px] border border-[rgba(15,31,68,0.08)] mb-4 relative z-[1]">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="w-8 h-8 rounded-full bg-[#E85C5C] text-white grid place-items-center font-bold text-[13px]">{initials}</span>
        <span className="text-[13px] text-[#6E7791] font-semibold">
          Posting as <b className="text-[#0F1F44]">{anonymous ? 'A Kaya family · anonymous' : familyDisplayName}</b>
        </span>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title — short, like a tweet…"
        className="w-full border-none outline-none px-3 py-2.5 bg-[#FBF7EE] rounded-xl text-[14px] text-[#0F1F44] font-semibold placeholder:text-[#6E7791] mb-2"
        maxLength={120}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What spark do you have for Kaya? (idea, bug, story, or a question…)"
        className="w-full border-none outline-none px-3 py-2.5 bg-[#FBF7EE] rounded-xl text-[14px] text-[#0F1F44] resize-none min-h-[64px] placeholder:text-[#6E7791]"
        maxLength={2000}
      />
      {err && <p className="mt-2 text-[12px] text-red-600 font-semibold">{err}</p>}
      <div className="mt-3 flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex gap-1.5 flex-wrap">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`text-[12px] px-2.5 py-1 rounded-full font-semibold border ${
                category === c
                  ? 'bg-[#0F1F44] text-white border-[#0F1F44]'
                  : 'bg-[#FBF7EE] text-[#0F1F44] border-[rgba(15,31,68,0.08)]'
              }`}
            >
              {categoryEmoji(c)} {categoryLabel(c)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-2 bg-[#FBF7EE] px-2.5 py-1.5 rounded-full text-[12px] text-[#0F1F44] font-semibold cursor-pointer">
            <span className={`flex items-center gap-1.5 ${anonymous ? 'opacity-60' : ''}`}>
              <span className="w-2 h-2 rounded-full bg-[#5BB85B]" />
              Family name
            </span>
            <span className="relative inline-block w-9 h-[22px]">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="opacity-0 w-0 h-0 absolute"
              />
              <span className={`absolute inset-0 rounded-full transition-colors ${anonymous ? 'bg-[#D4A847]' : 'bg-[#D9D9D9]'}`} />
              <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow transition-all ${anonymous ? 'left-[19px]' : 'left-[3px]'}`} />
            </span>
            <span className={`${anonymous ? '' : 'opacity-60'}`}>🕶 Anonymous</span>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="bg-[#E85C5C] text-white border-none px-3.5 py-2 rounded-[10px] font-bold text-[13px] cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Sparking…' : 'Spark it →'}
          </button>
        </div>
      </div>
    </div>
  );
}
