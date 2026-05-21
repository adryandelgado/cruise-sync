import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { EnvBanner } from "@/components/layout/EnvBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    if (!env.supabaseConfigured) return;

    const {
      data: { session },
    } = await supabase().auth.getSession();

    if (!session) {
      throw redirect({ to: "/login" });
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
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
