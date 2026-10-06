import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('celular peruano con espacios → E.164', () => {
    expect(normalizePhone('987 654 321')).toBe('+51987654321');
  });
  it('con +51 y guiones → mismo E.164', () => {
    expect(normalizePhone('+51 987-654-321')).toBe('+51987654321');
  });
  it('número extranjero con prefijo', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678');
  });
  it('basura → null', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('hola')).toBeNull();
  });
});
