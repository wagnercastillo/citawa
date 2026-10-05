'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor, useMe } from '@/lib/use-me';

export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me) router.replace(homeFor(me.role));
  }, [me, router]);
  return <p className="p-8 text-slate-500">Cargando…</p>;
}
