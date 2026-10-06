'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { Patient } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

export default function PatientsPage() {
  const me = useClinicMe();
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState('');

  const load = useCallback((query: string) => {
    api<Patient[]>(`/patients${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(setPatients)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (me) load('');
  }, [me, load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError('');
    try {
      await api('/patients', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.get('fullName'),
          phone: form.get('phone'),
          whatsappOptIn: form.get('whatsappOptIn') === 'on',
          notes: form.get('notes') || undefined,
        }),
      });
      formEl.reset();
      load(q);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!me) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <h1 className="text-xl font-bold">Pacientes</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        className="flex gap-2"
      >
        <Input placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline">Buscar</Button>
      </form>

      <ul className="divide-y rounded-lg border bg-white">
        {patients.map((p) => (
          <li key={p.id}>
            <Link href={`/app/patients/${p.id}`} className="flex items-center justify-between p-3 hover:bg-slate-50">
              <span className="font-medium">{p.fullName}</span>
              <span className="text-sm text-slate-500">
                {p.phone} {p.whatsappOptIn ? '· WhatsApp ✓' : '· sin consentimiento'}
              </span>
            </Link>
          </li>
        ))}
        {!patients.length && <li className="p-3 text-sm text-slate-500">No hay pacientes.</li>}
      </ul>

      <Card>
        <CardHeader><CardTitle className="text-base">Nuevo paciente</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input id="fullName" name="fullName" required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">Celular</Label>
              <Input id="phone" name="phone" placeholder="987 654 321" required />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="notes">Notas</Label>
              <Input id="notes" name="notes" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="whatsappOptIn" />
              El paciente acepta recibir recordatorios por WhatsApp
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Guardar paciente</Button>
            </div>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
