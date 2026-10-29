import { Injectable } from '@nestjs/common';

/** Reloj inyectable (en tests se congela para verificar recordatorios con reloj simulado). */
@Injectable()
export class ClockService {
  private fixed: Date | null = null;
  now(): Date {
    return this.fixed ? new Date(this.fixed.getTime()) : new Date();
  }
  nowIso(): string {
    return this.now().toISOString();
  }
  set(d: Date | string | null): void {
    this.fixed = d === null ? null : new Date(d);
  }
  advance(ms: number): void {
    this.fixed = new Date(this.now().getTime() + ms);
  }
}
