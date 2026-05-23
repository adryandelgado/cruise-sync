import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { AuthProvider } from "@/context/AuthContext";

const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((d) => ({
        default: d.TanStackRouterDevtools,
      })),
    );

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
      <Suspense fallback={null}>
        <RouterDevtools />
      </Suspense>
    </AuthProvider>
  );
}
