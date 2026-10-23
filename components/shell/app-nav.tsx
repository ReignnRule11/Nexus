"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import { isCurrentPath, PRIMARY_NAV } from "@/lib/client/navigation";
import { useSession } from "@/lib/client/session";
import {
  BellIcon,
  CommunitiesIcon,
  HomeIcon,
  MessagesIcon,
  ProfileIcon,
  SearchIcon,
} from "@/components/ui/icons";

const ICONS = {
  home: HomeIcon,
  discover: SearchIcon,
  communities: CommunitiesIcon,
  messages: MessagesIcon,
  notifications: BellIcon,
  profile: ProfileIcon,
};

export function AppNav() {
  const pathname = usePathname();
  const { status, user, signOut } = useSession();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (status !== "authenticated") {
      setUnread(0);
      return;
    }
    let cancelled = false;
    void apiRequest<{ unreadCount: number }>("/api/notifications/unread-count")
      .then((body) => {
        if (!cancelled) {
          setUnread(body.unreadCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnread(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, pathname]);

  if (status === "loading") {
    return (
      <div className="nav-placeholder" role="status" aria-live="polite">
        Loading navigation
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return null;
  }

  return (
    <>
      <nav className="side-nav" aria-label="Primary">
        <Link href="/feed" className="brand-link">
          Project Nexus
        </Link>
        <ul className="nav-list">
          {PRIMARY_NAV.map((item) => {
            const Icon = ICONS[item.icon];
            const current = isCurrentPath(pathname, item.href);
            const isNotifications = item.href === "/notifications";
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={current ? "nav-link current" : "nav-link"}
                  aria-current={current ? "page" : undefined}
                >
                  <Icon className="nav-icon" />
                  <span>{item.label}</span>
                  {isNotifications && unread > 0 ? (
                    <span className="nav-count" aria-label={`${unread} unread`}>
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="nav-secondary">
          <Link href="/agent" className="nav-link quiet">
            AI agent
          </Link>
          {user.isModerator ? (
            <Link href="/moderation" className="nav-link quiet">
              Moderation
            </Link>
          ) : null}
          <button type="button" className="nav-link quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </nav>
      <nav className="bottom-nav" aria-label="Primary">
        <ul className="bottom-nav-list">
          {PRIMARY_NAV.map((item) => {
            const Icon = ICONS[item.icon];
            const current = isCurrentPath(pathname, item.href);
            const isNotifications = item.href === "/notifications";
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={current ? "bottom-link current" : "bottom-link"}
                  aria-current={current ? "page" : undefined}
                  aria-label={
                    isNotifications && unread > 0
                      ? `${item.label}, ${unread} unread`
                      : item.label
                  }
                >
                  <span className="bottom-icon-wrap">
                    <Icon className="nav-icon" />
                    {isNotifications && unread > 0 ? (
                      <span className="nav-dot" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="bottom-label">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
