'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me, Role } from './types';

export function homeFor(role: Role): '/admin' | '/app' {
  return role === 'SUPERADMIN' ? '/admin' : '/app';
}

export function useMe(): Me | null {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
      });
  }, [router]);
  return me;
}

/** Para páginas del consultorio: redirige al superadmin a /admin. */
export function useClinicMe(): Me | null {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me?.role === 'SUPERADMIN') router.replace('/admin');
  }, [me, router]);
  return me && me.clinic ? me : null;
}
