import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Anchor,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  BarChart3,
  Ship,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { signOut } from "@/lib/auth";
import { canAccessNavRoute, type NavRoute } from "@/lib/navAccess";
import { prefetchSidebarRoute } from "@/lib/queryPrefetch";
import { cn } from "@/lib/utils";

interface NavItem {
  to: NavRoute;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cspos", label: "CSPOs", icon: ClipboardList },
  { to: "/proposals", label: "Proposals", icon: FileText },
  { to: "/sales-quotes", label: "Sales quotes", icon: FileText },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/procurement", label: "Procurement", icon: ShoppingCart },
  { to: "/warehouse", label: "Warehouse", icon: Truck },
  { to: "/onboard", label: "Onboard", icon: Ship },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

export function Sidebar() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleSignOut() {
    await signOut();
    void navigate({ to: "/login" });
  }

  const navItems = NAV.filter((item) => canAccessNavRoute(profile?.role, item.to));

  const displayName = profile?.full_name ?? profile?.email ?? "…";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-stone-800 bg-stone-950">
      <div className="flex items-center gap-2 px-5 py-5">
        <Anchor className="h-5 w-5 text-brand-500" />
        <span className="text-lg font-semibold tracking-tight">ShipSync</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            onMouseEnter={() => prefetchSidebarRoute(qc, to)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-300 transition-colors hover:bg-stone-900 hover:text-stone-100",
            )}
            activeProps={{ className: "bg-stone-900 text-stone-100 font-medium" }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-stone-800 p-3">
        {profile ? (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
              {initials || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-stone-200">
                {displayName}
              </p>
              <p className="truncate text-xs capitalize text-stone-500">
                {profile.role.replace(/_/g, " ")}
              </p>
            </div>
            <button
              onClick={() => void handleSignOut()}
              title="Sign out"
              className="shrink-0 rounded p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="px-1 text-xs text-stone-600">v0.0.1 · pre-alpha</p>
        )}
      </div>
    </aside>
  );
}
