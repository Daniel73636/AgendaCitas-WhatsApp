import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Intención de anticipo. Hoy solo existe la simulación; no hay pasarela real. */
export interface DepositIntent {
  provider: 'mock';
  status: 'simulated';
  reference: string;
  amountCents: number;
  currency: string;
}

/**
 * Cobro del anticipo. `mock` solo con DEMO_MODE (no mueve dinero).
 * `none` rechaza el cobro público para que producción no confirme citas sin pagar.
 */
export interface PaymentProvider {
  readonly name: 'mock' | 'none';
  createDeposit(input: { appointmentId: string; amountCents: number; currency: string }): Promise<DepositIntent>;
}

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createDeposit(input: { appointmentId: string; amountCents: number; currency: string }): Promise<DepositIntent> {
    return {
      provider: 'mock',
      status: 'simulated',
      reference: `mock_${input.appointmentId.replace(/-/g, '').slice(0, 12)}`,
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }
}

@Injectable()
export class NonePaymentProvider implements PaymentProvider {
  readonly name = 'none' as const;

  async createDeposit(): Promise<DepositIntent> {
    throw new AppError('FORBIDDEN', 'El pago en línea aún no está habilitado. Coordina el pago del anticipo directamente con el negocio.');
  }
}
