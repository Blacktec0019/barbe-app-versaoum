import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

/** undefined = ainda carregando; null = deslogado; objeto = sessão ativa */
export function useAuth() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return session;
}

export function googleName(user) {
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || '').trim();
}
