"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchData, refreshAccessToken, sendData, setAccessToken } from "@/lib/client/api";
import type { Role, SessionPayload, SessionUser } from "@/types/api";

type Status = "loading" | "authenticated" | "anonymous";
type Level = "read" | "write" | "admin";

const LEVELS: Record<Level, Role[]> = {
  read: ["admin", "operator", "viewer"],
  write: ["admin", "operator"],
  admin: ["admin"],
};

interface AuthValue {
  user: SessionUser | null;
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  applySession: (session: SessionPayload) => void;
  refreshUser: () => Promise<void>;
  can: (level: Level) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let active = true;
    refreshAccessToken().then((session) => {
      if (!active) return;
      if (session) {
        setUser(session.user);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const applySession = useCallback((session: SessionPayload) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      applySession(await sendData<SessionPayload>("post", "/auth/login", { email, password }));
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      applySession(await sendData<SessionPayload>("post", "/auth/register", { name, email, password }));
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await sendData("post", "/auth/logout");
    } catch {
      // The session may already be invalid; local state is cleared regardless.
    }
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
    router.replace("/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    setUser(await fetchData<SessionUser>("/users/me"));
  }, []);

  const can = useCallback((level: Level) => (user ? LEVELS[level].includes(user.role) : false), [user]);

  const value = useMemo<AuthValue>(
    () => ({ user, status, signIn, register, signOut, applySession, refreshUser, can }),
    [user, status, signIn, register, signOut, applySession, refreshUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
