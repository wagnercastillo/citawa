'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await api('/auth/logout', { method: 'POST' });
        router.replace('/login');
      }}
    >
      Cerrar sesión
    </Button>
  );
}
