'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState('Conectando tu WhatsApp…');
  const [failed, setFailed] = useState(false);
  const sent = useRef(false);

  const complete = useCallback(() => {
    setFailed(false);
    setMessage('Conectando tu WhatsApp…');
    const state = params.get('state') ?? '';
    const channels = params.get('channels') ?? '';
    api('/whatsapp/onboarding/complete', { method: 'POST', body: JSON.stringify({ state, channels }) })
      .then(() => {
        setMessage('✅ WhatsApp conectado. Las plantillas quedaron en revisión de Meta (puede tardar hasta 24 h).');
        if (window.opener) {
          window.opener.postMessage({ type: 'wa-connected' }, window.location.origin);
          window.close();
        } else {
          setTimeout(() => router.replace('/app/settings'), 2000);
        }
      })
      .catch((e) => {
        setFailed(true);
        setMessage((e as Error).message);
      });
  }, [params, router]);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    complete();
  }, [complete]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-8 text-center">
      <p className={failed ? 'text-red-600' : ''}>{message}</p>
      {failed && (
        <div className="flex justify-center gap-4 text-sm">
          <button type="button" onClick={complete} className="underline">Reintentar</button>
          <Link href="/app/settings" className="underline">Volver a Configuración</Link>
        </div>
      )}
    </main>
  );
}

export default function WhatsappCallbackPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center">Cargando…</p>}>
      <Callback />
    </Suspense>
  );
}
