'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/use-me';

export default function ClinicHome() {
  const me = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me?.role === 'SUPERADMIN') router.replace('/admin');
  }, [me, router]);

  if (!me || !me.clinic) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{me.clinic.name}</h1>
          <p className="text-sm text-slate-500">Hola {me.name}</p>
        </div>
        <LogoutButton />
      </header>
      {me.clinic.subscriptionStatus !== 'ACTIVE' && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Tu suscripción está vencida. Comunícate con soporte para evitar que se detengan los recordatorios.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agenda</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">La agenda llega en la siguiente etapa.</CardContent>
      </Card>
      {me.role === 'OWNER' && (
        <Link href="/app/users" className="inline-block text-sm font-medium text-emerald-700 underline">
          Gestionar usuarios
        </Link>
      )}
    </main>
  );
}
