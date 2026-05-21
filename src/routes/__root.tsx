import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { EnvBanner } from "@/components/layout/EnvBanner";
import { Sidebar } from "@/components/layout/Sidebar";

const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/router-devtools").then((d) => ({
        default: d.TanStackRouterDevtools,
      })),
    );

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <EnvBanner />
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
      <Suspense fallback={null}>
        <RouterDevtools />
      </Suspense>
    </div>
  );
}
