export type NavItem = {
  href: string;
  label: string;
  icon: "home" | "discover" | "communities" | "messages" | "notifications" | "profile";
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/feed", label: "Home", icon: "home" },
  { href: "/discover", label: "Discover", icon: "discover" },
  { href: "/communities", label: "Communities", icon: "communities" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  { href: "/profile", label: "Profile", icon: "profile" },
];

export function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/feed") {
    return pathname === "/feed" || pathname.startsWith("/posts/");
  }
  if (href === "/profile") {
    return pathname === "/profile" || pathname.startsWith("/users/");
  }
  if (href === "/communities") {
    return pathname === "/communities" || pathname.startsWith("/communities/");
  }
  if (href === "/messages") {
    return pathname === "/messages" || pathname.startsWith("/messages/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
