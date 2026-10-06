import { onboardingUrl, parseChannels } from './onboarding';

describe('onboarding utils', () => {
  it('arma la URL del popup con redirect y state codificados', () => {
    const url = new URL(onboardingUrl('P123', 'http://localhost:3000/app/settings/whatsapp/callback', 'abc_-1'));
    expect(url.origin + url.pathname).toBe('https://app.360dialog.com/dashboard/app/P123/permissions');
    expect(url.searchParams.get('redirect_url')).toBe('http://localhost:3000/app/settings/whatsapp/callback');
    expect(url.searchParams.get('state')).toBe('abc_-1');
  });

  it('acepta los formatos de channels que devuelve 360dialog', () => {
    expect(parseChannels('[abc,def]')).toEqual(['abc', 'def']);
    expect(parseChannels('["abc"]')).toEqual(['abc']);
    expect(parseChannels('abc')).toEqual(['abc']);
    expect(parseChannels(' [ abc ] ')).toEqual(['abc']);
    expect(parseChannels('')).toEqual([]);
    expect(parseChannels('[]')).toEqual([]);
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels('[a b]')).toEqual([]);
  });
});
