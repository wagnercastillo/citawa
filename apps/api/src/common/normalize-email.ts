import { Transform } from 'class-transformer';

export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
