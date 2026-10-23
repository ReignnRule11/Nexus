"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, clearClientSessionState, isApiError } from "@/lib/client/api";
import type { SessionUser } from "@/lib/client/types";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "inactive";

type SessionContextValue = {
  status: SessionStatus;
  user: SessionUser | null;
  refresh: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUserState] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await apiRequest<{ user: SessionUser }>("/api/auth/me");
      setUserState(body.user);
      setStatus("authenticated");
    } catch (error) {
      setUserState(null);
      if (isApiError(error) && error.code === "account_inactive") {
        setStatus("inactive");
        return;
      }
      setStatus("anonymous");
    }
  }, []);

  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
    setStatus(next ? "authenticated" : "anonymous");
  }, []);

  const signOut = useCallback(async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    clearClientSessionState();
    setUserState(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, user, refresh, setUser, signOut }),
    [status, user, refresh, setUser, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
