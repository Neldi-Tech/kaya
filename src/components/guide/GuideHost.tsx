'use client';

// Mounted once in the app layout. Listens for openModuleGuide() and renders
// the ModuleGuidePlayer over the whole app. Keeps the launcher decoupled —
// the FAB, a module's ▶ pill, and the Videos library all just fire the event.

import { useEffect, useState } from 'react';
import { GUIDE_EVENT, getGuide, markGuideWatched, type ModuleGuide } from '@/lib/moduleGuides';
import ModuleGuidePlayer from './ModuleGuidePlayer';

export default function GuideHost() {
  const [guide, setGuide] = useState<ModuleGuide | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const g = getGuide(id);
      if (g && g.available && g.scenes.length > 0) setGuide(g);
    };
    window.addEventListener(GUIDE_EVENT, onOpen);
    return () => window.removeEventListener(GUIDE_EVENT, onOpen);
  }, []);

  if (!guide) return null;
  return (
    <ModuleGuidePlayer
      key={guide.id}                 /* remount on guide switch (e.g. "go deeper") */
      guide={guide}
      onClose={() => setGuide(null)}
      onWatched={(id) => markGuideWatched(id)}
    />
  );
}
