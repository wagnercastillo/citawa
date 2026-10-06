'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { WEEKDAYS } from '@/lib/format';
import type { BusinessHour, ClinicSettings, Service } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

function ClinicDataCard({ settings, onSaved }: { settings: ClinicSettings; onSaved: (s: ClinicSettings) => void }) {
  const [msg, setMsg] = useState('');
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMsg('');
    try {
      const saved = await api<ClinicSettings>('/clinic', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.get('name'),
          address: form.get('address'),
          paymentInstructions: form.get('paymentInstructions'),
          send2hToConfirmed: form.get('send2hToConfirmed') === 'on',
        }),
      });
      onSaved(saved);
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Datos del consultorio</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" defaultValue={settings.name} required minLength={2} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="address">Dirección (se envía en el recordatorio de 2 h)</Label>
            <Input id="address" name="address" defaultValue={settings.address ?? ''} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="paymentInstructions">Instrucciones de pago (número Yape, link…)</Label>
            <textarea
              id="paymentInstructions"
              name="paymentInstructions"
              defaultValue={settings.paymentInstructions ?? ''}
              rows={3}
              maxLength={500}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="send2hToConfirmed" defaultChecked={settings.send2hToConfirmed} />
            Enviar el recordatorio de 2 h también a quienes ya confirmaron
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit">Guardar</Button>
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function HoursCard() {
  const [rows, setRows] = useState<BusinessHour[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<BusinessHour[]>('/clinic/hours').then(setRows);
  }, []);

  const update = (i: number, patch: Partial<BusinessHour>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setMsg('');
    try {
      setRows(await api<BusinessHour[]>('/clinic/hours', { method: 'PUT', body: JSON.stringify({ hours: rows }) }));
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Horario de atención</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={r.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              className="rounded-md border px-2 py-1 text-sm"
            >
              {WEEKDAYS.map((d, n) => <option key={n} value={n}>{d}</option>)}
            </select>
            <Input type="time" value={r.opensAt} onChange={(e) => update(i, { opensAt: e.target.value })} className="w-32" />
            <span className="text-sm">a</span>
            <Input type="time" value={r.closesAt} onChange={(e) => update(i, { closesAt: e.target.value })} className="w-32" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</Button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">Sin horario configurado.</p>}
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setRows([...rows, { weekday: 1, opensAt: '09:00', closesAt: '13:00' }])}>
            Agregar franja
          </Button>
          <Button type="button" onClick={save}>Guardar horario</Button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ServicesCard() {
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Service[]>('/services').then(setServices);
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      await api('/services', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), durationMin: Number(form.get('durationMin')) }),
      });
      formEl.reset();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Servicios</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded border">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <span className={s.active ? '' : 'text-slate-400 line-through'}>{s.name} · {s.durationMin} min</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(() => api(`/services/${s.id}`, { method: 'PATCH', body: JSON.stringify({ active: !s.active }) }))}
              >
                {s.active ? 'Desactivar' : 'Activar'}
              </Button>
            </li>
          ))}
          {!services.length && <li className="p-2 text-sm text-slate-500">Todavía no hay servicios.</li>}
        </ul>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="svc-name">Nombre</Label>
            <Input id="svc-name" name="name" required minLength={2} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="svc-duration">Duración (min)</Label>
            <Input id="svc-duration" name="durationMin" type="number" min={5} max={480} step={5} defaultValue={30} className="w-28" required />
          </div>
          <Button type="submit">Agregar servicio</Button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const me = useClinicMe();
  const router = useRouter();
  const [settings, setSettings] = useState<ClinicSettings | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.role !== 'OWNER') router.replace('/app');
    else api<ClinicSettings>('/clinic').then(setSettings);
  }, [me, router]);

  if (!me || me.role !== 'OWNER' || !settings) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <h1 className="text-xl font-bold">Configuración</h1>
      <ClinicDataCard settings={settings} onSaved={setSettings} />
      <HoursCard />
      <ServicesCard />
    </main>
  );
}
