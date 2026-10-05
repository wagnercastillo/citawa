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
