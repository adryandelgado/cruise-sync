export const USER_ROLES = [
  "admin",
  "sales",
  "pm",
  "warehouse_supervisor",
  "warehouse_operator",
  "purchase",
  "onboard_bookkeeper",
  "drydock_bookkeeper",
  "viewer",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type NavRoute =
  | "/"
  | "/cspos"
  | "/proposals"
  | "/sales-quotes"
  | "/inventory"
  | "/procurement"
  | "/warehouse"
  | "/onboard"
  | "/reports";

export const ALL_NAV_ROUTES: NavRoute[] = [
  "/",
  "/cspos",
  "/proposals",
  "/sales-quotes",
  "/inventory",
  "/procurement",
  "/warehouse",
  "/onboard",
  "/reports",
];

const ROLE_NAV: Record<UserRole, NavRoute[]> = {
  admin: ALL_NAV_ROUTES,
  pm: ALL_NAV_ROUTES,
  sales: ["/", "/proposals", "/sales-quotes", "/cspos", "/reports"],
  warehouse_supervisor: [
    "/",
    "/cspos",
    "/inventory",
    "/procurement",
    "/warehouse",
    "/reports",
  ],
  warehouse_operator: ["/", "/warehouse", "/inventory"],
  purchase: ["/", "/inventory", "/procurement", "/reports"],
  onboard_bookkeeper: ["/", "/cspos", "/onboard", "/reports"],
  drydock_bookkeeper: ["/", "/cspos", "/onboard", "/reports"],
  viewer: ["/", "/cspos", "/reports"],
};

function isUserRole(role: string): role is UserRole {
  return (USER_ROLES as readonly string[]).includes(role);
}

export function navRoutesForRole(role: string | null | undefined): NavRoute[] {
  if (!role) return ALL_NAV_ROUTES;
  if (!isUserRole(role)) return ALL_NAV_ROUTES;
  return ROLE_NAV[role];
}

export function canAccessNavRoute(
  role: string | null | undefined,
  route: NavRoute,
): boolean {
  return navRoutesForRole(role).includes(route);
}

export function canAccessPath(role: string | null | undefined, pathname: string): boolean {
  const allowed = navRoutesForRole(role);

  if (pathname === "/" || pathname === "") {
    return allowed.includes("/");
  }

  return allowed.some(
    (route) => route !== "/" && (pathname === route || pathname.startsWith(`${route}/`)),
  );
}

export function canCreateCspo(role: string | null | undefined): boolean {
  if (!role) return true;
  return role === "admin" || role === "pm";
}
