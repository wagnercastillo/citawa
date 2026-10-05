'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { ClinicRow } from '@/lib/types';
import { useMe } from '@/lib/use-me';

function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">
      <span className="truncate">{url}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}

function ClinicItem({ clinic, onChanged }: { clinic: ClinicRow; onChanged: () => void }) {
  const [paidUntil, setPaidUntil] = useState(clinic.paidUntil ?? '');
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');

  async function savePaidUntil() {
    setError('');
    try {
      await api(`/admin/clinics/${clinic.id}`, { method: 'PATCH', body: JSON.stringify({ paidUntil }) });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reinvite() {
    setError('');
    try {
      const res = await api<{ inviteUrl: string }>(`/admin/clinics/${clinic.id}/reinvite-owner`, { method: 'POST' });
      setInviteUrl(res.inviteUrl);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{clinic.name}</p>
          <p className="text-sm text-slate-500">
            {clinic.owner ? `${clinic.owner.name} · ${clinic.owner.email}` : 'Sin dueño'}
            {clinic.owner?.pending && ' · invitación pendiente'}
          </p>
          <p className="text-xs text-slate-500">Suscripción: {clinic.subscriptionStatus}</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`paid-${clinic.id}`} className="text-xs">Pagado hasta</Label>
            <Input id={`paid-${clinic.id}`} type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
          </div>
          <Button size="sm" onClick={savePaidUntil} disabled={!paidUntil}>Guardar</Button>
          {clinic.owner?.pending && (
            <Button size="sm" variant="outline" onClick={reinvite}>Nuevo enlace</Button>
          )}
        </div>
      </div>
      {inviteUrl && <InviteLink url={inviteUrl} />}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function AdminPage() {
  const me = useMe();
  const router = useRouter();
  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<ClinicRow[]>('/admin/clinics').then(setClinics).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.role !== 'SUPERADMIN') router.replace('/app');
    else load();
  }, [me, router, load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError('');
    setInviteUrl('');
    try {
      const res = await api<{ clinic: ClinicRow; inviteUrl: string }>('/admin/clinics', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          address: form.get('address') || undefined,
          ownerName: form.get('ownerName'),
          ownerEmail: form.get('ownerEmail'),
        }),
      });
      setInviteUrl(res.inviteUrl);
      formEl.reset();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!me || me.role !== 'SUPERADMIN') return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Consultorios</h1>
        <LogoutButton />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo consultorio</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Nombre del consultorio</Label>
              <Input id="name" name="name" required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" name="address" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ownerName">Nombre del dueño</Label>
              <Input id="ownerName" name="ownerName" required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ownerEmail">Email del dueño</Label>
              <Input id="ownerEmail" name="ownerEmail" type="email" required />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Crear e invitar</Button>
            </div>
          </form>
          {inviteUrl && (
            <>
              <p className="mt-4 text-sm">Envía este enlace al dueño (vence en 72 h):</p>
              <InviteLink url={inviteUrl} />
            </>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <ul className="space-y-3">
        {clinics.map((c) => (
          <ClinicItem key={c.id} clinic={c} onChanged={load} />
        ))}
        {!clinics.length && <p className="text-sm text-slate-500">Todavía no hay consultorios.</p>}
      </ul>
    </main>
  );
}
