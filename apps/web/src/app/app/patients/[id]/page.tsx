'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fmtDayHeader, fmtTime, localDate, STATUS_CLASS, STATUS_LABEL } from '@/lib/format';
import type { Appointment, ClinicSettings, Patient } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useClinicMe();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [tz, setTz] = useState('America/Lima');
  const [msg, setMsg] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!me) return;
    api<Patient>(`/patients/${id}`).then(setPatient).catch(() => setNotFound(true));
    api<Appointment[]>(`/patients/${id}/appointments`).then(setHistory).catch(() => setHistory([]));
    api<ClinicSettings>('/clinic').then((s) => setTz(s.timezone));
  }, [me, id]);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setMsg('');
    try {
      setPatient(
        await api<Patient>(`/patients/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: form.get('fullName'),
            phone: form.get('phone'),
            notes: form.get('notes'),
            whatsappOptIn: form.get('whatsappOptIn') === 'on',
          }),
        }),
      );
      setMsg('Guardado');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  if (!me) return <p className="p-8 text-slate-500">Cargando…</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />
      <Link href="/app/patients" className="text-sm underline">← Pacientes</Link>
      {notFound && <p className="text-sm text-red-600">Paciente no encontrado.</p>}
      {patient && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">{patient.fullName}</CardTitle></CardHeader>
            <CardContent>
              <form key={patient.id + patient.phone} onSubmit={onSave} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fullName">Nombre completo</Label>
                  <Input id="fullName" name="fullName" defaultValue={patient.fullName} required minLength={2} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="phone">Celular</Label>
                  <Input id="phone" name="phone" defaultValue={patient.phone} required />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="notes">Notas</Label>
                  <Input id="notes" name="notes" defaultValue={patient.notes ?? ''} />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="whatsappOptIn" defaultChecked={patient.whatsappOptIn} />
                  Acepta recibir recordatorios por WhatsApp
                  {patient.optInAt && (
                    <span className="text-xs text-slate-500">(desde {localDate(patient.optInAt, tz)})</span>
                  )}
                </label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button type="submit">Guardar</Button>
                  {msg && <span className="text-sm text-slate-600">{msg}</span>}
                </div>
              </form>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="font-semibold">Historial de citas</h2>
            <ul className="divide-y rounded-lg border bg-white">
              {history.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    {fmtDayHeader(localDate(a.startsAt, tz))} · {fmtTime(a.startsAt, tz)} · {a.service?.name}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </li>
              ))}
              {!history.length && <li className="p-3 text-sm text-slate-500">Sin citas todavía.</li>}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
