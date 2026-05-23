import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { EnvBanner } from "@/components/layout/EnvBanner";
import { MigrationBanner } from "@/components/layout/MigrationBanner";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { RoutePending } from "@/components/shared/RoutePending";
import { env } from "@/lib/env";
import { canAccessPath } from "@/lib/navAccess";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authed")({
  pendingComponent: RoutePending,
  beforeLoad: async ({ location }) => {
    if (!env.supabaseConfigured) return;

    const {
      data: { session },
    } = await supabase().auth.getSession();

    if (!session) {
      throw redirect({ to: "/login" });
    }

    const { data: profile } = await supabase()
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profile?.role && !canAccessPath(profile.role, location.pathname)) {
      throw redirect({ to: "/" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <EnvBanner />
        <MigrationBanner />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
