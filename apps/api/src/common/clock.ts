/** Reloj inyectable: en producción la hora real, en tests un FakeClock. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
