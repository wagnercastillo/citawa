'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { addDays, fmtDayHeader, fmtTime, localDate, startOfWeek, STATUS_CLASS, STATUS_LABEL, todayIn } from '@/lib/format';
import type { Appointment, AppointmentStatus, ClinicSettings, Patient, Service } from '@/lib/types';
import { useClinicMe } from '@/lib/use-me';

type View = 'day' | 'week';

const NEXT_ACTIONS: Record<AppointmentStatus, { status: AppointmentStatus; label: string }[]> = {
  SCHEDULED: [
    { status: 'CONFIRMED', label: 'Confirmar' },
    { status: 'ATTENDED', label: 'Asistió' },
    { status: 'NO_SHOW', label: 'No asistió' },
  ],
  CONFIRMED: [
    { status: 'ATTENDED', label: 'Asistió' },
    { status: 'NO_SHOW', label: 'No asistió' },
  ],
  ATTENDED: [{ status: 'NO_SHOW', label: 'Marcar no asistió' }],
  NO_SHOW: [{ status: 'ATTENDED', label: 'Marcar asistió' }],
  CANCELLED: [],
};

function PatientPicker({ value, onChange }: { value: Patient | null; onChange: (p: Patient | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded border p-2 text-sm">
        <span>{value.fullName} · {value.phone}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="Nombre o teléfono del paciente" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          onClick={async () => setResults(await api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`))}
        >
          Buscar
        </Button>
      </div>
      {results.map((p) => (
        <button
          type="button"
          key={p.id}
          className="block w-full rounded border p-2 text-left text-sm hover:bg-slate-50"
          onClick={() => {
            onChange(p);
            setResults([]);
          }}
        >
          {p.fullName} · {p.phone}
        </button>
      ))}
    </div>
  );
}

function NewAppointmentCard({ services, defaultDate, onCreated }: { services: Service[]; defaultDate: string; onCreated: () => void }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState('');
  const active = services.filter((s) => s.active);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!patient) {
      setError('Elige un paciente');
      return;
    }
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      await api('/appointments', {
        method: 'POST',
        body: JSON.stringify({ patientId: patient.id, serviceId: form.get('serviceId'), date: form.get('date'), time: form.get('time') }),
      });
      setPatient(null);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Nueva cita</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <PatientPicker value={patient} onChange={setPatient} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="serviceId">Servicio</Label>
              <select id="serviceId" name="serviceId" required className="w-full rounded-md border px-2 py-2 text-sm">
                {active.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" name="date" type="date" defaultValue={defaultDate} key={defaultDate} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="time">Hora</Label>
              <Input id="time" name="time" type="time" step={300} required />
            </div>
          </div>
          {!active.length && <p className="text-sm text-amber-700">Primero crea un servicio en Configuración.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={!active.length}>Agendar</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BlockCard({ defaultDate, onCreated }: { defaultDate: string; onCreated: () => void }) {
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    try {
      await api('/appointments/blocks', {
        method: 'POST',
        body: JSON.stringify({ date: form.get('date'), time: form.get('time'), endTime: form.get('endTime') }),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Bloquear horario</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="b-date">Fecha</Label>
            <Input id="b-date" name="date" type="date" defaultValue={defaultDate} key={defaultDate} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-time">Desde</Label>
            <Input id="b-time" name="time" type="time" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-end">Hasta</Label>
            <Input id="b-end" name="endTime" type="time" required />
          </div>
          <Button type="submit" variant="outline">Bloquear</Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function AppointmentRow({ appt, tz, services, onChanged }: { appt: Appointment; tz: string; services: Service[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      setEditing(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const setStatus = (status: AppointmentStatus) =>
    run(() => api(`/appointments/${appt.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }));

  async function onEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(() =>
      api(`/appointments/${appt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: form.get('date'), time: form.get('time'), serviceId: form.get('serviceId') }),
      }),
    );
  }

  const editable = !appt.isBlock && (appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED');

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-mono">{fmtTime(appt.startsAt, tz)}–{fmtTime(appt.endsAt, tz)}</span>{' '}
          {appt.isBlock ? (
            <span className="font-medium text-slate-500">Bloqueado</span>
          ) : (
            <>
              <span className="font-medium">{appt.patient?.fullName}</span>
              <span className="text-slate-500"> · {appt.service?.name}</span>
            </>
          )}
        </div>
        {!appt.isBlock && (
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[appt.status]}`}>{STATUS_LABEL[appt.status]}</span>
        )}
      </div>
      {appt.status !== 'CANCELLED' && (
        <div className="flex flex-wrap gap-2">
          {!appt.isBlock && NEXT_ACTIONS[appt.status].map((a) => (
            <Button key={a.status} size="sm" variant="outline" onClick={() => setStatus(a.status)}>{a.label}</Button>
          ))}
          {editable && <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>Editar</Button>}
          {(editable || appt.isBlock) && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (window.confirm(appt.isBlock ? '¿Quitar este bloqueo?' : '¿Cancelar esta cita?')) setStatus('CANCELLED');
              }}
            >
              {appt.isBlock ? 'Quitar bloqueo' : 'Cancelar'}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <form onSubmit={onEdit} className="flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
          <Input name="date" type="date" defaultValue={localDate(appt.startsAt, tz)} className="w-40" required />
          <Input name="time" type="time" step={300} defaultValue={fmtTime(appt.startsAt, tz)} className="w-32" required />
          <select name="serviceId" defaultValue={appt.service?.id} className="rounded-md border px-2 py-2 text-sm">
            {services.filter((s) => s.active || s.id === appt.service?.id).map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>
            ))}
          </select>
          <Button type="submit" size="sm">Guardar</Button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function AgendaPage() {
  const me = useClinicMe();
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    api<ClinicSettings>('/clinic').then((s) => {
      setSettings(s);
      setAnchor(todayIn(s.timezone));
    });
    api<Service[]>('/services').then(setServices);
  }, [me]);

  const range = useMemo(() => {
    if (!anchor) return null;
    const from = view === 'day' ? anchor : startOfWeek(anchor);
    return { from, to: view === 'day' ? from : addDays(from, 6) };
  }, [anchor, view]);

  const load = useCallback(() => {
    if (!range) return;
    api<Appointment[]>(`/appointments?from=${range.from}&to=${range.to}`)
      .then(setAppointments)
      .catch((e) => setError((e as Error).message));
  }, [range]);

  useEffect(load, [load]);

  if (!me || !settings || !anchor || !range) return <p className="p-8 text-slate-500">Cargando…</p>;

  const tz = settings.timezone;
  const days = view === 'day' ? [range.from] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
  const step = view === 'day' ? 1 : 7;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <AppHeader me={me} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant={view === 'day' ? 'default' : 'outline'} onClick={() => setView('day')}>Día</Button>
          <Button size="sm" variant={view === 'week' ? 'default' : 'outline'} onClick={() => setView('week')}>Semana</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, -step))}>←</Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayIn(tz))}>Hoy</Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, step))}>→</Button>
          <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="w-40" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {days.map((day) => {
        const items = appointments.filter((a) => localDate(a.startsAt, tz) === day);
        return (
          <section key={day} className="space-y-2">
            <h2 className="font-semibold capitalize">{fmtDayHeader(day)}</h2>
            <ul className="divide-y rounded-lg border bg-white">
              {items.map((a) => (
                <AppointmentRow key={a.id} appt={a} tz={tz} services={services} onChanged={load} />
              ))}
              {!items.length && <li className="p-3 text-sm text-slate-500">Sin citas.</li>}
            </ul>
          </section>
        );
      })}

      <NewAppointmentCard services={services} defaultDate={anchor} onCreated={load} />
      <BlockCard defaultDate={anchor} onCreated={load} />
    </main>
  );
}
