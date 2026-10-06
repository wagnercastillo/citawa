import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Devuelve el teléfono en E.164 (+51987654321) o null si no es válido. */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'PE'): string | null {
  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}
