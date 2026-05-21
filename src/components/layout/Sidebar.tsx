import { Link } from "@tanstack/react-router";
import {
  Anchor,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cspos", label: "CSPOs", icon: ClipboardList },
  { to: "/proposals", label: "Proposals", icon: FileText },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/procurement", label: "Procurement", icon: ShoppingCart },
  { to: "/warehouse", label: "Warehouse", icon: Truck },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-stone-800 bg-stone-950">
      <div className="flex items-center gap-2 px-5 py-5">
        <Anchor className="h-5 w-5 text-brand-500" />
        <span className="text-lg font-semibold tracking-tight">ShipSync</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-300 transition-colors hover:bg-stone-900 hover:text-stone-100",
            )}
            activeProps={{
              className:
                "bg-stone-900 text-stone-100 font-medium",
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-stone-800 px-4 py-3 text-xs text-stone-500">
        v0.0.1 · pre-alpha
      </div>
    </aside>
  );
}
