import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { AuthProvider } from "@/context/AuthContext";

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
    <AuthProvider>
      <Outlet />
      <Suspense fallback={null}>
        <RouterDevtools />
      </Suspense>
    </AuthProvider>
  );
}
