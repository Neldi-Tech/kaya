// Race a promise against a deadline. The underlying work is NOT cancelled
// (a Firebase upload can't be), but the caller stops waiting — so a weak
// network can never leave a screen stuck on "Working…" forever.
export class TimeoutError extends Error {
  constructor(public label: string, ms: number) {
    super(`${label}-timeout-${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'op'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
