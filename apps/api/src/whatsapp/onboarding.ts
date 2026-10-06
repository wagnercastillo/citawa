export function onboardingUrl(partnerId: string, redirectUrl: string, state: string): string {
  const url = new URL(`https://app.360dialog.com/dashboard/app/${encodeURIComponent(partnerId)}/permissions`);
  url.searchParams.set('redirect_url', redirectUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

const CHANNEL_RE = /^[A-Za-z0-9_-]+$/;

/** 360dialog devuelve channels como "[a,b]", '["a"]' o "a". Devuelve solo ids con formato válido. */
export function parseChannels(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const ids = inner
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  return ids.every((id) => CHANNEL_RE.test(id)) ? ids : [];
}
