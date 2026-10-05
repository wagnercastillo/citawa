'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { PublicUser } from '@/lib/types';
import { useMe } from '@/lib/use-me';

export default function UsersPage() {
  const me = useMe();
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<PublicUser[]>('/users').then(setUsers).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.role !== 'OWNER') router.replace(me.role === 'SUPERADMIN' ? '/admin' : '/app');
    else load();
  }, [me, router, load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      const res = await api<{ inviteUrl: string }>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), email: form.get('email') }),
      });
      setInviteUrl(res.inviteUrl);
      formEl.reset();
    });
  }

  if (!me || me.role !== 'OWNER') return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usuarios</h1>
        <Link href="/app" className="text-sm underline">Volver</Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invitar recepcionista</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="flex items-end">
              <Button type="submit">Invitar</Button>
            </div>
          </form>
          {inviteUrl && (
            <div className="mt-4 flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">
              <span className="truncate">{inviteUrl}</span>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copiar</Button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <ul className="divide-y rounded-lg border bg-white">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">
                {u.name} <span className="text-xs text-slate-500">({u.role === 'OWNER' ? 'Dueño' : 'Recepción'})</span>
              </p>
              <p className="text-sm text-slate-500">
                {u.email}
                {u.pending && ' · invitación pendiente'}
                {!u.active && ' · desactivado'}
              </p>
            </div>
            {u.id !== me.id && (
              <div className="flex gap-2">
                {u.pending && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(async () => {
                        const res = await api<{ inviteUrl: string }>(`/users/${u.id}/reinvite`, { method: 'POST' });
                        setInviteUrl(res.inviteUrl);
                      })
                    }
                  >
                    Nuevo enlace
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={u.active ? 'destructive' : 'default'}
                  onClick={() =>
                    run(() => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }))
                  }
                >
                  {u.active ? 'Desactivar' : 'Activar'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
