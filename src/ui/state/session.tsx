/**
 * Session context. On mount it fetches GET /api/me (which NEVER 401s — it is
 * pure role/demo discovery) and exposes the viewer's role plus convenience
 * booleans and auth actions. login()/logout() call the API then refresh /api/me
 * so the rest of the tree re-renders against the authoritative server view —
 * the role is never inferred from the (HTTP-only, unreadable) cookie.
 *
 * In demo mode the server reports role:'owner', demo:true — the viewer is
 * owner-equivalent and read-only; the Shell renders a banner and hides Login.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api.js';
import type { Me, Role } from '../lib/types.js';

export interface Session {
  loading: boolean;
  role: Role;
  username: string | null;
  demo: boolean;
  ownerConfigured: boolean;
  isOwner: boolean;
  isCrew: boolean;
  /** Authenticated = anything other than an anonymous guest (owner or crew, or demo's owner-equivalent). */
  isAuthed: boolean;
  /** Re-fetch GET /api/me (after a login/logout, or to recover from a stale view). */
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const GUEST_ME: Me = { role: 'guest', username: null, demo: false, ownerConfigured: true };

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me>(GUEST_ME);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await api.me();
      if (alive.current) setMe(next);
    } catch {
      // /api/me should never fail; if the network hiccups, fall back to guest
      // so the gate stays closed (fail safe) rather than open.
      if (alive.current) setMe(GUEST_ME);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      await api.login(username, password);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async (): Promise<void> => {
    await api.logout();
    await refresh();
  }, [refresh]);

  const value = useMemo<Session>(() => {
    const isOwner = me.role === 'owner';
    const isCrew = me.role === 'crew';
    return {
      loading,
      role: me.role,
      username: me.username,
      demo: me.demo,
      ownerConfigured: me.ownerConfigured,
      isOwner,
      isCrew,
      isAuthed: me.role !== 'guest',
      refresh,
      login,
      logout,
    };
  }, [me, loading, refresh, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a <SessionProvider>');
  return ctx;
}
