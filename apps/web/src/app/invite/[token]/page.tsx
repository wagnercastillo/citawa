'use client';

import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { homeFor } from '@/lib/use-me';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ name: string; email: string }>(`/auth/invite/${token}`).then(setInfo).catch(() => setInvalid(true));
  }, [token]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get('password') !== form.get('confirm')) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const me = await api<Me>('/auth/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password: form.get('password') }),
      });
      router.replace(homeFor(me.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{info ? `Hola ${info.name}, crea tu contraseña` : 'Invitación'}</CardTitle>
        </CardHeader>
        <CardContent>
          {invalid && (
            <p className="text-sm text-red-600">
              Esta invitación no es válida o ya venció. Pide un enlace nuevo a quien te invitó.
            </p>
          )}
          {info && (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-slate-600">Tu usuario será {info.email}</p>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña (mínimo 8 caracteres)</Label>
                <Input id="password" name="password" type="password" minLength={8} maxLength={72} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Repite la contraseña</Label>
                <Input id="confirm" name="confirm" type="password" minLength={8} maxLength={72} required />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Guardando…' : 'Activar mi cuenta'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
