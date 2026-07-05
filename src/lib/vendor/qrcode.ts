// Minimal, dependency-free QR Code encoder (byte mode, EC level M).
//
// Vendored in-repo instead of adding an npm dependency (Elia 2026-07-04:
// "vendor a zero-dep encoder" — avoids lockfile churn across the many
// shared worktrees). Supports QR versions 1–10 (payload up to 216 bytes
// at level M) which comfortably covers a Kaya share URL.
//
// Implements ISO/IEC 18004: GF(256) Reed–Solomon error correction,
// block interleaving, function-pattern placement, all 8 data masks with
// penalty-based selection, and BCH format information. Verified
// module-for-module against the `qrcode` npm package (fixed-mask) for
// versions 1–10 before shipping — see the PR description.

// ── Galois field GF(256), primitive polynomial 0x11D ────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let j = 0; j < gen.length - 1; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return res;
}

// ── Version tables (EC level M) ─────────────────────────────────────
// [ecCodewordsPerBlock, g1Blocks, g1DataCw, g2Blocks, g2DataCw]
const EC_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

// Alignment pattern centre coordinates per version.
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function dataCapacityCodewords(v: number): number {
  const [, g1, d1, g2, d2] = EC_M[v];
  return g1 * d1 + g2 * d2;
}

function charCountBits(v: number): number {
  return v <= 9 ? 8 : 16; // byte mode
}

// ── Bit buffer ──────────────────────────────────────────────────────
class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
}

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const capacityBits = dataCapacityCodewords(v) * 8;
    const needed = 4 + charCountBits(v) + byteLen * 8;
    if (needed <= capacityBits) return v;
  }
  throw new Error('qr: payload too large for supported versions (max ~216 bytes)');
}

function buildCodewords(bytes: number[], v: number): number[] {
  const [ecLen, g1, d1, g2, d2] = EC_M[v];
  const totalData = dataCapacityCodewords(v);

  const bb = new BitBuffer();
  bb.put(0b0100, 4); // byte mode
  bb.put(bytes.length, charCountBits(v));
  for (const b of bytes) bb.put(b, 8);
  // terminator
  const cap = totalData * 8;
  for (let i = 0; i < 4 && bb.bits.length < cap; i++) bb.bits.push(0);
  // pad to byte boundary
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  // pad bytes
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bb.bits.length < cap) {
    const p = padBytes[pi++ % 2];
    for (let i = 7; i >= 0; i--) bb.bits.push((p >> i) & 1);
  }
  // to data codewords
  const dataCw: number[] = [];
  for (let i = 0; i < bb.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
    dataCw.push(byte);
  }

  // split into blocks
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let idx = 0;
  for (let b = 0; b < g1; b++) { const blk = dataCw.slice(idx, idx + d1); idx += d1; blocks.push(blk); ecBlocks.push(rsEncode(blk, ecLen)); }
  for (let b = 0; b < g2; b++) { const blk = dataCw.slice(idx, idx + d2); idx += d2; blocks.push(blk); ecBlocks.push(rsEncode(blk, ecLen)); }

  // interleave data
  const out: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
  // interleave EC
  for (let i = 0; i < ecLen; i++) for (const eb of ecBlocks) out.push(eb[i]);
  return out;
}

// ── Matrix placement ────────────────────────────────────────────────
type Grid = { size: number; mods: Int8Array; fn: Uint8Array }; // mods: -1 unset, 0/1; fn: 1 if function/reserved

function newGrid(size: number): Grid {
  const mods = new Int8Array(size * size).fill(-1);
  const fn = new Uint8Array(size * size);
  return { size, mods, fn };
}
const at = (g: Grid, r: number, c: number) => r * g.size + c;
function set(g: Grid, r: number, c: number, val: number, isFn: boolean) {
  g.mods[at(g, r, c)] = val;
  if (isFn) g.fn[at(g, r, c)] = 1;
}

function placeFinder(g: Grid, r: number, c: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= g.size || cc < 0 || cc >= g.size) continue;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(g, rr, cc, dark ? 1 : 0, true);
    }
  }
}

function placeAlignment(g: Grid, v: number) {
  const centers = ALIGN[v];
  for (const r of centers) {
    for (const c of centers) {
      // skip if overlaps a finder
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= g.size - 9) || (r >= g.size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          set(g, r + dr, c + dc, dark ? 1 : 0, true);
        }
      }
    }
  }
}

function placeTimingAndDark(g: Grid, v: number) {
  for (let i = 8; i < g.size - 8; i++) {
    if (g.mods[at(g, 6, i)] === -1) set(g, 6, i, i % 2 === 0 ? 1 : 0, true);
    if (g.mods[at(g, i, 6)] === -1) set(g, i, 6, i % 2 === 0 ? 1 : 0, true);
  }
  set(g, 4 * v + 9, 8, 1, true); // dark module
}

function reserveFormat(g: Grid, v: number) {
  for (let i = 0; i < 9; i++) {
    if (g.mods[at(g, 8, i)] === -1) set(g, 8, i, 0, true);
    if (g.mods[at(g, i, 8)] === -1) set(g, i, 8, 0, true);
  }
  for (let i = 0; i < 8; i++) {
    set(g, 8, g.size - 1 - i, 0, true);
    set(g, g.size - 1 - i, 8, 0, true);
  }
  if (v >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      set(g, i, g.size - 9 - j, 0, true);
      set(g, g.size - 9 - j, i, 0, true);
    }
  }
}

function placeData(g: Grid, codewords: number[]) {
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bitIdx = 0;
  let upward = true;
  for (let col = g.size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column
    for (let i = 0; i < g.size; i++) {
      const row = upward ? g.size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (g.mods[at(g, row, cc)] === -1) {
          g.mods[at(g, row, cc)] = bitIdx < bits.length ? bits[bitIdx] : 0;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

function maskFn(m: number, r: number, c: number): boolean {
  switch (m) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(g: Grid, m: number): Grid {
  const out: Grid = { size: g.size, mods: g.mods.slice(), fn: g.fn };
  for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) {
    if (!g.fn[at(g, r, c)] && maskFn(m, r, c)) out.mods[at(g, r, c)] ^= 1;
  }
  return out;
}

function formatBits(mask: number): number {
  // EC level M = 0b00
  const data = (0b00 << 3) | mask; // 5 bits
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0x537 : 0);
  const bits = ((data << 10) | rem) ^ 0x5412;
  return bits & 0x7fff;
}

function placeFormat(g: Grid, mask: number) {
  const bits = formatBits(mask);
  // Format bits are placed MSB-first (bit 14 at index 0) per ISO/IEC 18004.
  const get = (i: number) => (bits >> (14 - i)) & 1;
  // around top-left + split copies
  for (let i = 0; i <= 5; i++) set(g, 8, i, get(i), true);
  set(g, 8, 7, get(6), true);
  set(g, 8, 8, get(7), true);
  set(g, 7, 8, get(8), true);
  for (let i = 9; i <= 14; i++) set(g, 14 - i, 8, get(i), true);
  // Second copy: bits 0-6 up column 8 (bottom), bits 7-14 along row 8 (right).
  for (let i = 0; i <= 6; i++) set(g, g.size - 1 - i, 8, get(i), true);
  for (let i = 7; i <= 14; i++) set(g, 8, g.size - 8 + (i - 7), get(i), true);
  set(g, g.size - 8, 8, 1, true); // dark module (always set)
}

function versionBits(v: number): number {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) ? 0x1f25 : 0);
  return (v << 12) | rem;
}

function placeVersion(g: Grid, v: number) {
  if (v < 7) return;
  const bits = versionBits(v);
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    set(g, r, g.size - 11 + c, b, true);
    set(g, g.size - 11 + c, r, b, true);
  }
}

function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;
  const m = (r: number, c: number) => g.mods[at(g, r, c)];
  // Rule 1: runs of 5+
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (m(r, c) === m(r, c - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
      else run = 1;
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (m(r, c) === m(r - 1, c)) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
      else run = 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m(r, c);
    if (v === m(r, c + 1) && v === m(r + 1, c) && v === m(r + 1, c + 1)) score += 3;
  }
  // Rule 3: finder-like patterns 1:1:3:1:1
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const check = (arr: number[]) => arr.join('') === pat1.join('') || arr.join('') === pat2.join('');
  for (let r = 0; r < n; r++) for (let c = 0; c < n - 10; c++) {
    const win = []; for (let k = 0; k < 11; k++) win.push(m(r, c + k));
    if (check(win)) score += 40;
  }
  for (let c = 0; c < n; c++) for (let r = 0; r < n - 10; r++) {
    const win = []; for (let k = 0; k < 11; k++) win.push(m(r + k, c));
    if (check(win)) score += 40;
  }
  // Rule 4: dark proportion
  let dark = 0;
  for (let i = 0; i < n * n; i++) if (g.mods[i] === 1) dark++;
  const pct = (dark * 100) / (n * n);
  const five = Math.floor(Math.abs(pct - 50) / 5);
  score += five * 10;
  return score;
}

/** Build the QR module matrix for `text` (boolean grid, true = dark).
 *  `forceMask` (0–7) pins the data mask — for verification only; production
 *  callers omit it so the lowest-penalty mask is chosen automatically. */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = pickVersion(bytes.length);
  const codewords = buildCodewords(bytes, v);
  const size = 17 + 4 * v;

  const base = newGrid(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  // separators are implicitly the 0-ring drawn by placeFinder (dr/dc -1..7)
  placeAlignment(base, v);
  placeTimingAndDark(base, v);
  reserveFormat(base, v);
  placeData(base, codewords);

  let best: Grid | null = null;
  let bestScore = Infinity;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const g = applyMask(base, mask);
    placeFormat(g, mask);
    placeVersion(g, v);
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  const g = best as Grid;
  const out: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(g.mods[at(g, r, c)] === 1);
    out.push(row);
  }
  return out;
}

/** Render `text` as a crisp, self-contained SVG string (dark on white,
 *  4-module quiet zone). `px` is the target pixel size of the whole code. */
export function qrSvg(text: string, px = 160): string {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#17223C">${rects}</g></svg>`;
}
