'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/logout-button';
import type { Me } from '@/lib/types';

export function AppHeader({ me }: { me: Me }) {
  const pathname = usePathname();
  const links = [
    { href: '/app', label: 'Agenda' },
    { href: '/app/patients', label: 'Pacientes' },
    ...(me.role === 'OWNER'
      ? [
          { href: '/app/settings', label: 'Configuración' },
          { href: '/app/users', label: 'Usuarios' },
        ]
      : []),
  ];
  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));

  return (
    <header className="space-y-3 border-b pb-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">{me.clinic?.name}</p>
          <p className="text-xs text-slate-500">{me.name}</p>
        </div>
        <LogoutButton />
      </div>
      {me.clinic && me.clinic.subscriptionStatus !== 'ACTIVE' && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          Tu suscripción está vencida. Comunícate con soporte para evitar que se detengan los recordatorios.
        </p>
      )}
      <nav className="flex flex-wrap gap-2 text-sm">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded px-3 py-1 ${isActive(l.href) ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 border'}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
