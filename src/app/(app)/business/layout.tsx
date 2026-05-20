// Business route group — dresses every /business page in the shared
// honey/cream section theme (same family as The Hive, per the v2 mockup).
// No section tab bar: the Portfolio is the hub and the app's own nav +
// BackBar carry navigation, so the AppShell mobile bar stays visible.

export default function BusinessSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-lato bg-hive-cream text-hive-navy min-h-screen">
      {children}
    </div>
  );
}
