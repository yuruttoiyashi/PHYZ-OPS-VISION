import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type UserRole = 'admin' | 'manager' | 'leader' | 'viewer';

export type AppProfile = {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  centerId: string | null;
  centerName: string | null;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: AppProfile | null;
  initialized: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchProfile(userId: string): Promise<AppProfile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        `
        id,
        name,
        email,
        role,
        center_id,
        centers (
          name
        )
        `,
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('プロフィール取得エラー:', error.message);
      return null;
    }

    if (!data) return null;

    const centerRelation = Array.isArray(data.centers)
      ? data.centers[0]
      : data.centers;

    return {
      id: data.id,
      name: data.name ?? null,
      email: data.email ?? null,
      role: (data.role ?? 'viewer') as UserRole,
      centerId: data.center_id ?? null,
      centerName: centerRelation?.name ?? null,
    };
  } catch (error) {
    console.error('fetchProfile例外:', error);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        setProfile(null);
        return;
      }

      const nextProfile = await fetchProfile(currentUser.id);
      setProfile(nextProfile);
    } catch (error) {
      console.error('refreshProfile例外:', error);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          const nextProfile = await fetchProfile(currentSession.user.id);
          if (!mounted) return;
          setProfile(nextProfile);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('bootstrap例外:', error);
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setProfile(null);
      } finally {
        if (mounted) {
          setInitialized(true);
        }
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      void (async () => {
        try {
          if (nextSession?.user) {
            const nextProfile = await fetchProfile(nextSession.user.id);
            if (!mounted) return;
            setProfile(nextProfile);
          } else {
            if (!mounted) return;
            setProfile(null);
          }
        } catch (error) {
          console.error('onAuthStateChange例外:', error);
          if (!mounted) return;
          setProfile(null);
        } finally {
          if (mounted) {
            setInitialized(true);
          }
        }
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('ログアウトエラー:', error.message);
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      user,
      profile,
      initialized,
      signOut,
      refreshProfile,
    }),
    [session, user, profile, initialized, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth は AuthProvider の中で使用してください。');
  }

  return context;
}