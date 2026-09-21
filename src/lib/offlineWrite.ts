// 📴 Kaya Offline (O1) — the queued-write await.
//
// With Firestore's on-device cache ON, an offline write is accepted into the
// local queue IMMEDIATELY — but its promise only resolves when the SERVER
// acknowledges, i.e. after reconnect. A plain `await` therefore spins a save
// button forever with no internet. This helper races the write against a
// short window:
//   · resolves fast when online (normal ack) — nothing changes;
//   · rejects fast on a real error inside the window (permission denied…)
//     so callers still show honest errors;
//   · after the window, assumes "queued offline" and lets the UI move on —
//     the write is already safely in the queue, and the suspended promise
//     continues harmlessly in the background on reconnect.

export async function awaitQueuedWrite<T>(write: Promise<T>, windowMs = 2500): Promise<void> {
  // Keep a rejection AFTER the window from becoming an unhandled error.
  write.catch(() => {});
  await Promise.race([
    write.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, windowMs)),
  ]);
}
