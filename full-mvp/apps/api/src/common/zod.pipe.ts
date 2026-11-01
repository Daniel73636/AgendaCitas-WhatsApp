import { type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Valida con Zod y devuelve el valor ya transformado. Los errores salen como VALIDATION_ERROR. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.output<T> {
    return this.schema.parse(value ?? {});
  }
}
export const zod = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);
