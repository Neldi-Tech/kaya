'use client';

// One-time importer for historical daily ratings — typically pasted
// from a Google Sheet log. Flow:
//   1. Paste the sheet (TSV from Google Sheets, CSV also fine).
//   2. We auto-detect columns and guess mappings (kid, date, period,
//      comment, routine columns). Parent confirms / adjusts.
//   3. Map each rating-cell value ("Excellent", "good", "👍", "1", …)
//      to one of: excellent / good / bad / skip.
//   4. Preview the parsed rows with per-row warnings.
//   5. Import — calls `importRating()` per row. Re-running the import
//      replaces the prior row for the same (childId, date, period) so
//      it's idempotent.
//
// Lives at /settings/import; linked from the Settings page. Parent-only
// (the (app) layer scopes who can see Settings).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  importRating, Routine, RatingValue,
} from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

type Period = 'morning' | 'evening';

// Special column-mapping sentinels.
const COL_IGNORE = '__ignore__';

// Per-row parsed shape ready for submission.
interface ParsedRow {
  childId: string;
  childLabel: string;     // for the preview UI when childId resolves
  date: string;           // YYYY-MM-DD
  period: Period;
  ratings: Record<string, RatingValue>; // routineId → value
  totalPoints: number;
  comment?: string;
  warnings: string[];
  // Skipped rows (warnings.length > 0 AND something fatal) are surfaced
  // but not submitted.
  skip: boolean;
}

export default function ImportPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { family, children } = useFamily();
  const routines: Routine[] = family?.routines || [];

  const [step, setStep] = useState<'paste' | 'map' | 'preview' | 'done'>('paste');
  const [raw, setRaw] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  // Column → role mapping. Each header in `headers` is mapped to one of:
  //   - '__ignore__'  (skip the column)
  //   - 'kid'         (which child the row is for — name match or handle)
  //   - 'date'        (YYYY-MM-DD or anything Date can parse)
  //   - 'period'      (morning / evening)
  //   - 'comment'     (free text — preserved on the rating doc)
  //   - 'routine:<id>'(maps the column's cell to a specific routine's rating)
  const [colMap, setColMap] = useState<Record<string, string>>({});

  // Per-token → RatingValue mapping. Built from the unique cell values
  // we observed in the routine columns. Default guesses applied on
  // detection; parent can adjust.
  const [valueMap, setValueMap] = useState<Record<string, RatingValue | 'unset'>>({});

  // Optional fallback period if the sheet has separate sections per
  // period and no period column — parent picks one for the whole paste.
  const [fallbackPeriod, setFallbackPeriod] = useState<Period>('morning');
  const [periodFromColumn, setPeriodFromColumn] = useState(true);

  // Submission state
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; replaced: number; skipped: number } | null>(null);
  const [error, setError] = useState('');

  // ── Step 1 → 2: parse pasted sheet ───────────────────────────────
  const parsePaste = () => {
    setError('');
    if (!raw.trim()) { setError('Paste the sheet content first.'); return; }
    // TSV first (Google Sheets default copy); fall back to CSV when no
    // tab is found in the header line.
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) { setError('Need at least a header row and one data row.'); return; }
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const splitLine = (l: string) => splitDelimited(l, delim);
    const head = splitLine(lines[0]).map((h) => h.trim());
    const data = lines.slice(1).map(splitLine);
    if (head.length === 0) { setError('Could not find any columns in the header row.'); return; }
    setHeaders(head);
    setRows(data);

    // Auto-guess column mappings.
    const guess: Record<string, string> = {};
    head.forEach((h) => {
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Identity columns
      if (/^kid|^child|name/.test(norm)) guess[h] = 'kid';
      else if (/date|day/.test(norm)) guess[h] = 'date';
      else if (/period|time(of day)?|am|pm|session/.test(norm)) guess[h] = 'period';
      else if (/comment|note|remark/.test(norm)) guess[h] = 'comment';
      else {
        // Try to match a routine by EN or SW label.
        const r = routines.find((rt) => {
          const en = rt.label.toLowerCase().replace(/[^a-z0-9]/g, '');
          const sw = (rt.labelSw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return en && norm.includes(en.slice(0, Math.min(4, en.length)))
            || sw && norm.includes(sw.slice(0, Math.min(4, sw.length)));
        });
        if (r) guess[h] = `routine:${r.id}`;
        else guess[h] = COL_IGNORE;
      }
    });
    setColMap(guess);
    setStep('map');
  };

  // Detected unique cell values in routine columns — drives the value-mapping UI.
  const routineCells = useMemo(() => {
    const routineCols = headers
      .map((h, i) => ({ h, i, role: colMap[h] }))
      .filter((c) => c.role && c.role.startsWith('routine:'));
    const set = new Set<string>();
    for (const row of rows) {
      for (const c of routineCols) {
        const v = (row[c.i] || '').trim();
        if (v) set.add(v);
      }
    }
    return Array.from(set);
  }, [rows, headers, colMap]);

  // Seed value-map guesses whenever the detected cells change.
  useEffect(() => {
    setValueMap((prev) => {
      const next: Record<string, RatingValue | 'unset'> = { ...prev };
      for (const v of routineCells) {
        if (next[v]) continue;
        next[v] = guessRatingValue(v);
      }
      return next;
    });
  }, [routineCells]);

  // ── Step 2 → 3: build preview rows ───────────────────────────────
  const parsedRows: ParsedRow[] = useMemo(() => {
    if (step === 'paste' || headers.length === 0) return [];
    const colIndex: Record<string, number[]> = {}; // role → indices
    headers.forEach((h, i) => {
      const role = colMap[h];
      if (!role || role === COL_IGNORE) return;
      colIndex[role] = colIndex[role] || [];
      colIndex[role].push(i);
    });

    return rows.map((row): ParsedRow => {
      const warnings: string[] = [];

      // Kid resolution — match by name (case-insensitive), then handle.
      const kidIdx = colIndex['kid']?.[0];
      const rawKid = kidIdx !== undefined ? (row[kidIdx] || '').trim() : '';
      const child = children.find(
        (c) =>
          c.name.toLowerCase() === rawKid.toLowerCase() ||
          (c.handle && c.handle.toLowerCase() === rawKid.toLowerCase().replace(/^@/, '')),
      );
      if (!child && rawKid) warnings.push(`No kid matches "${rawKid}"`);
      else if (!rawKid) warnings.push('Missing kid');

      // Date
      const dateIdx = colIndex['date']?.[0];
      const rawDate = dateIdx !== undefined ? (row[dateIdx] || '').trim() : '';
      const date = parseDate(rawDate);
      if (!date) warnings.push(rawDate ? `Bad date "${rawDate}"` : 'Missing date');

      // Period — column or fallback
      let period: Period = fallbackPeriod;
      if (periodFromColumn) {
        const pIdx = colIndex['period']?.[0];
        const rawP = pIdx !== undefined ? (row[pIdx] || '').trim().toLowerCase() : '';
        if (/^morn|^am|^a\.?m/.test(rawP)) period = 'morning';
        else if (/^even|^pm|^p\.?m|^night/.test(rawP)) period = 'evening';
        else if (rawP) warnings.push(`Unknown period "${rawP}"`);
      }

      // Ratings — walk every routine column, look up value in valueMap.
      const ratings: Record<string, RatingValue> = {};
      let total = 0;
      const routineCols = headers
        .map((h, i) => ({ h, i, role: colMap[h] }))
        .filter((c) => c.role && c.role.startsWith('routine:'));
      for (const c of routineCols) {
        const cell = (row[c.i] || '').trim();
        if (!cell) continue;
        const routineId = c.role.slice('routine:'.length);
        const routine = routines.find((r) => r.id === routineId);
        if (!routine) continue;
        // Period filter — only credit routine if it belongs to this period.
        if (routine.period !== period) continue;
        const mapped = valueMap[cell];
        if (!mapped || mapped === 'unset') {
          warnings.push(`No mapping for "${cell}"`);
          continue;
        }
        if (mapped === 'skip') continue;
        ratings[routineId] = mapped;
        if (mapped === 'excellent') total += routine.pointsExcellent;
        else if (mapped === 'good') total += routine.pointsGood;
        else if (mapped === 'bad') total += routine.pointsBad;
      }

      // Comment
      const commentIdx = colIndex['comment']?.[0];
      const comment = commentIdx !== undefined ? (row[commentIdx] || '').trim() : '';

      const fatal = !child || !date;
      return {
        childId: child?.id || '',
        childLabel: child?.name || rawKid || '—',
        date: date || rawDate,
        period,
        ratings,
        totalPoints: total,
        comment: comment || undefined,
        warnings,
        skip: fatal,
      };
    });
  }, [headers, rows, colMap, valueMap, children, routines, periodFromColumn, fallbackPeriod, step]);

  const validCount = parsedRows.filter((r) => !r.skip).length;
  const skipCount = parsedRows.length - validCount;
  const allValuesMapped = routineCells.every((v) => valueMap[v] && valueMap[v] !== 'unset');

  // ── Step 3 → 4: run the import ───────────────────────────────────
  const runImport = async () => {
    if (!profile?.familyId || isGuest) { setError('Sign-in required to import.'); return; }
    setError('');
    setImporting(true);
    setProgress(0);
    let created = 0, replaced = 0, skipped = 0;
    for (let i = 0; i < parsedRows.length; i++) {
      const r = parsedRows[i];
      if (r.skip) { skipped++; continue; }
      try {
        const res = await importRating(profile.familyId, {
          childId: r.childId,
          date: r.date,
          period: r.period,
          ratings: r.ratings,
          totalPoints: r.totalPoints,
          ratedBy: profile.uid,
          ratedByName: profile.displayName,
          comment: r.comment,
        } as any);
        if (res.action === 'created') created++;
        else replaced++;
      } catch (e) {
        skipped++;
      }
      setProgress(Math.round(((i + 1) / parsedRows.length) * 100));
    }
    setImporting(false);
    setResult({ created, replaced, skipped });
    setStep('done');
  };

  const startOver = () => {
    setStep('paste');
    setRaw('');
    setHeaders([]);
    setRows([]);
    setColMap({});
    setValueMap({});
    setResult(null);
    setProgress(0);
    setError('');
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-4xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Settings · One-time</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Import past ratings</h1>
        <p className="text-sm text-kaya-sand mt-1">
          Paste your Google Sheet, map the columns, preview, import. Comments are preserved.
        </p>
      </div>

      <Stepper step={step} />

      {/* Step 1 — paste */}
      {step === 'paste' && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 space-y-3">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Step 1 — Paste your sheet</p>
          <p className="text-[12px] text-kaya-sand leading-relaxed">
            In your Google Sheet, select the rows including the header row, hit ⌘/Ctrl-C, and paste below.
            We accept tab- or comma-separated data. A typical layout:
          </p>
          <div className="text-[11px] font-mono bg-kaya-cream rounded-kaya-sm p-2 text-kaya-chocolate overflow-x-auto whitespace-pre">
{`Kid     Date         Period   Making bed  Brushing teeth  Comment
Amani   2026-05-10   morning  Excellent   Good            "Slept in"
Zuri    2026-05-10   morning  Good        Excellent
…`}
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            placeholder="Paste here…"
            className="w-full p-3 bg-kaya-cream rounded-kaya-sm text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={parsePaste}
              disabled={!raw.trim()}
              className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
            >
              Detect columns →
            </button>
            <button
              onClick={() => router.push('/settings')}
              className="h-10 px-3 text-[11px] font-bold text-kaya-sand"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — column mapping */}
      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
            <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-1">Step 2 — Map columns</p>
            <p className="text-[12px] text-kaya-sand mb-3 leading-relaxed">
              Tell us what each column is. Set columns to <em>Ignore</em> if you don&apos;t want them imported.
            </p>
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold truncate">{h}</p>
                    <p className="text-[10px] text-kaya-sand-light truncate">
                      Sample: {(rows[0] && rows[0][headers.indexOf(h)]) || '—'}
                    </p>
                  </div>
                  <select
                    value={colMap[h] || COL_IGNORE}
                    onChange={(e) => setColMap((m) => ({ ...m, [h]: e.target.value }))}
                    className="h-9 px-2 bg-kaya-cream rounded-kaya-sm text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 min-w-[180px]"
                  >
                    <option value={COL_IGNORE}>Ignore</option>
                    <option value="kid">👧 Kid</option>
                    <option value="date">📅 Date</option>
                    <option value="period">🌗 Period</option>
                    <option value="comment">💬 Comment</option>
                    <optgroup label="Routines">
                      {routines.map((r) => (
                        <option key={r.id} value={`routine:${r.id}`}>
                          {r.icon} {r.label} ({r.period})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-kaya-warm-dark/60">
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={periodFromColumn}
                  onChange={(e) => setPeriodFromColumn(e.target.checked)}
                />
                Period comes from a column above
              </label>
              {!periodFromColumn && (
                <div className="mt-2 flex gap-2">
                  {(['morning', 'evening'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setFallbackPeriod(p)}
                      className={`flex-1 h-9 rounded-kaya-sm text-xs font-bold ${
                        fallbackPeriod === p ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
                      }`}
                    >
                      {p === 'morning' ? '☀️ Morning' : '🌙 Evening'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Value mapping — only shows if we found routine columns. */}
          {routineCells.length > 0 && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
              <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-1">
                Map cell values → rating
              </p>
              <p className="text-[12px] text-kaya-sand mb-3 leading-relaxed">
                We found these unique values in your routine columns. Map each one.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {routineCells.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-mono font-bold truncate bg-kaya-cream px-2 py-1 rounded-kaya-sm">{v}</p>
                    </div>
                    <select
                      value={valueMap[v] || 'unset'}
                      onChange={(e) => setValueMap((m) => ({ ...m, [v]: e.target.value as RatingValue | 'unset' }))}
                      className="h-9 px-2 bg-kaya-cream rounded-kaya-sm text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                    >
                      <option value="unset">— Pick —</option>
                      <option value="excellent">🌟 Excellent</option>
                      <option value="good">👍 Good</option>
                      <option value="bad">👎 Bad</option>
                      <option value="skip">— Skip cell</option>
                    </select>
                  </div>
                ))}
              </div>
              {!allValuesMapped && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-kaya-sm px-2 py-1.5 mt-3">
                  Map every value before continuing — unmapped cells will be left blank in the import.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep('preview')}
              disabled={!allValuesMapped && routineCells.length > 0}
              className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
            >
              Preview rows →
            </button>
            <button onClick={() => setStep('paste')} className="h-10 px-3 text-[11px] font-bold text-kaya-sand">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — preview */}
      {step === 'preview' && (
        <div className="space-y-3">
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
            <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-1">Step 3 — Preview</p>
            <p className="text-[12px] text-kaya-sand leading-relaxed">
              <strong className="text-green-700">{validCount}</strong> rows ready to import.{' '}
              {skipCount > 0 && (
                <strong className="text-red-700">{skipCount}</strong>
              )}{skipCount > 0 ? ' rows will be skipped (missing kid or date).' : ''}
              {' '}Re-running this import is safe — same kid + date + period rows are replaced.
            </p>
          </div>

          <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-kaya-warm">
                <tr>
                  <th className="text-left p-2 font-bold">Kid</th>
                  <th className="text-left p-2 font-bold">Date</th>
                  <th className="text-left p-2 font-bold">Period</th>
                  <th className="text-left p-2 font-bold">Points</th>
                  <th className="text-left p-2 font-bold">Comment</th>
                  <th className="text-left p-2 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r, i) => (
                  <tr key={i} className={`border-t border-kaya-warm-dark/40 ${r.skip ? 'bg-red-50/40' : ''}`}>
                    <td className="p-2">{r.childLabel}</td>
                    <td className="p-2 font-mono">{r.date || '—'}</td>
                    <td className="p-2 capitalize">{r.period}</td>
                    <td className="p-2 font-bold">{r.totalPoints}</td>
                    <td className="p-2 max-w-[200px] truncate" title={r.comment}>{r.comment || ''}</td>
                    <td className="p-2 text-[10px] text-amber-700">{r.warnings.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={runImport}
              disabled={importing || validCount === 0}
              className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
            >
              {importing ? `Importing ${progress}%…` : `Import ${validCount} rows`}
            </button>
            <button onClick={() => setStep('map')} disabled={importing} className="h-10 px-3 text-[11px] font-bold text-kaya-sand">
              ← Back to mapping
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — done */}
      {step === 'done' && result && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-5 space-y-3">
          <p className="text-3xl">✅</p>
          <p className="font-display text-lg font-black">Import complete</p>
          <ul className="text-sm space-y-1 text-kaya-chocolate">
            <li>• <strong className="text-green-700">{result.created}</strong> new ratings created</li>
            <li>• <strong className="text-kaya-gold-dark">{result.replaced}</strong> replaced existing rows</li>
            {result.skipped > 0 && (
              <li>• <strong className="text-red-700">{result.skipped}</strong> skipped</li>
            )}
          </ul>
          <p className="text-[11px] text-kaya-sand leading-relaxed">
            Totals were updated for each kid. Weekly totals only changed for rows dated within this week — historical
            rows kept your weekly leaderboard intact.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/reports')} className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold">
              View reports
            </button>
            <button onClick={startOver} className="h-10 px-3 text-[11px] font-bold text-kaya-sand">
              Import another sheet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function Stepper({ step }: { step: 'paste' | 'map' | 'preview' | 'done' }) {
  const steps: { key: typeof step; label: string }[] = [
    { key: 'paste', label: '1. Paste' },
    { key: 'map', label: '2. Map' },
    { key: 'preview', label: '3. Preview' },
    { key: 'done', label: '4. Done' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex gap-1 mb-4">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`flex-1 h-1.5 rounded-full ${i <= activeIdx ? 'bg-kaya-gold' : 'bg-kaya-warm-dark/40'}`}
          title={s.label}
        />
      ))}
    </div>
  );
}

// Split a CSV/TSV line, respecting quoted strings ("Hello, world").
// Google Sheets exports quote any cell that contains the delimiter, a
// quote, or a newline, doubling internal quotes ("" → ").
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === delim) { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function parseDate(raw: string): string {
  if (!raw) return '';
  // Already canonical?
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Try a forgiving Date parse; Sheets often produces "5/10/2026" or
  // "May 10, 2026". Date.parse is locale-sensitive but acceptable for a
  // one-time import where the parent reviews the preview.
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY explicit handler (Date often misreads
  // these as MM/DD/YYYY on US locale).
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return '';
}

// Guess a RatingValue from a cell's text. Conservative — anything
// ambiguous (e.g. bare numbers like 1, 4, 5 that could mean different
// things to different families) falls through to 'unset' so the parent
// confirms in the value-mapping UI.
function guessRatingValue(raw: string): RatingValue | 'unset' {
  const t = raw.trim().toLowerCase();
  if (!t) return 'unset';
  if (/^(excellent|exc|great|amazing|🌟|⭐|e)$/i.test(t)) return 'excellent';
  if (/^(good|g|ok|okay|fine|👍)$/i.test(t)) return 'good';
  if (/^(bad|poor|👎|b)$/i.test(t)) return 'bad';
  if (/^(skip|n\/?a|-|—)$/i.test(t)) return 'skip';
  return 'unset';
}
