import { Inject, Injectable } from '@nestjs/common';
import type { CustomerDto, MessageDto } from '@agenda/contracts';
import { type DbHandle, and, appointments, customers, decryptField, desc, encryptField, eq, isNull, isUniqueViolation, messageLog, sql, uuidv7, waitlistEntries } from '@agenda/db';
import { CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { ClockService } from '../../core/clock.service';
import { DB_HANDLE } from '../../core/db.provider';
import { toMessageDto } from '../../core/messaging.service';
import { fuzzyScore } from './fuzzy';

type CustomerRow = typeof customers.$inferSelect;
interface Stats { visits: number; spent: number; last: Date | null }

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ClockService) private readonly clock: ClockService,
  ) {}

  private notes(c: CustomerRow): string | null {
    if (!c.notesEnc) return null;
    try {
      return decryptField(c.notesEnc, this.config.fieldKey);
    } catch {
      return null;
    }
  }

  private toDto(c: CustomerRow, s?: Stats): CustomerDto {
    return {
      id: c.id, fullName: c.fullName, phone: c.phoneE164, email: c.email, birthday: c.birthday, notes: this.notes(c),
      noShowCount: c.noShowCount, lateCancelCount: c.lateCancelCount, tags: c.tags, consentWhatsapp: c.consentWhatsapp,
      visits: s?.visits ?? 0, totalSpentCents: s?.spent ?? 0, lastVisitAt: s?.last ? s.last.toISOString() : null, createdAt: c.createdAt.toISOString(),
    };
  }

  private async stats(tenantId: string): Promise<Map<string, Stats>> {
    const res = await this.handle.db.execute(sql`
      SELECT customer_id,
             count(*) FILTER (WHERE status = 'completed') AS visits,
             coalesce(sum(paid_cents) FILTER (WHERE status = 'completed'), 0) AS spent,
             max(starts_at) FILTER (WHERE status = 'completed') AS last
      FROM appointments WHERE tenant_id = ${tenantId} AND customer_id IS NOT NULL GROUP BY customer_id`);
    const rows = ((res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
    return new Map(rows.map((r) => [String(r.customer_id), { visits: Number(r.visits), spent: Number(r.spent), last: r.last ? new Date(r.last as string) : null }]));
  }

  async list(tenantId: string, q?: string, limit = 200): Promise<CustomerDto[]> {
    const rows = await this.handle.db.select().from(customers).where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    const st = await this.stats(tenantId);
    let scored = rows.map((c) => ({ c, score: q ? fuzzyScore(q, c.fullName, c.phoneE164, c.email) : 1 })).filter((x) => x.score > 0);
    scored = q ? scored.sort((a, b) => b.score - a.score || a.c.fullName.localeCompare(b.c.fullName)) : scored.sort((a, b) => a.c.fullName.localeCompare(b.c.fullName));
    return scored.slice(0, limit).map((x) => this.toDto(x.c, st.get(x.c.id)));
  }

  private async row(tenantId: string, id: string): Promise<CustomerRow> {
    const [c] = await this.handle.db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt))).limit(1);
    if (!c) throw new AppError('NOT_FOUND', 'Cliente no encontrado.');
    return c;
  }

  async get(tenantId: string, id: string): Promise<CustomerDto> {
    const c = await this.row(tenantId, id);
    return this.toDto(c, (await this.stats(tenantId)).get(id));
  }

  async create(tenantId: string, input: { fullName: string; phone: string; email?: string | null | undefined; birthday?: string | null | undefined; notes?: string | null | undefined; tags: string[]; consentWhatsapp: boolean }): Promise<CustomerDto> {
    const now = this.clock.now();
    try {
      const [c] = await this.handle.db
        .insert(customers)
        .values({
          id: uuidv7(), tenantId, fullName: input.fullName, phoneE164: input.phone, email: input.email || null, birthday: input.birthday ?? null,
          notesEnc: input.notes ? encryptField(input.notes, this.config.fieldKey) : null, tags: input.tags, consentWhatsapp: input.consentWhatsapp,
          createdAt: now, updatedAt: now,
        })
        .returning();
      return this.toDto(c!);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'Ya existe un cliente con ese celular. Usa "Unificar fichas" si es la misma persona.');
      throw e;
    }
  }

  async patch(tenantId: string, id: string, input: Partial<{ fullName: string; phone: string; email: string | null; birthday: string | null; notes: string | null; tags: string[]; consentWhatsapp: boolean }>): Promise<CustomerDto> {
    await this.row(tenantId, id);
    const set: Partial<typeof customers.$inferInsert> = { updatedAt: this.clock.now() };
    if (input.fullName !== undefined) set.fullName = input.fullName;
    if (input.phone !== undefined) set.phoneE164 = input.phone;
    if (input.email !== undefined) set.email = input.email || null;
    if (input.birthday !== undefined) set.birthday = input.birthday;
    if (input.notes !== undefined) set.notesEnc = input.notes ? encryptField(input.notes, this.config.fieldKey) : null;
    if (input.tags !== undefined) set.tags = input.tags;
    if (input.consentWhatsapp !== undefined) set.consentWhatsapp = input.consentWhatsapp;
    try {
      await this.handle.db.update(customers).set(set).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'Ese celular ya pertenece a otro cliente. Usa "Unificar fichas".');
      throw e;
    }
    return this.get(tenantId, id);
  }

  /** Cliente que cambia de numero: unifica fichas (mueve citas, mensajes y contadores) con confirmacion previa en la UI. */
  async merge(tenantId: string, fromId: string, intoId: string): Promise<CustomerDto> {
    if (fromId === intoId) throw new AppError('VALIDATION_ERROR', 'Elige una ficha distinta para unificar.');
    const from = await this.row(tenantId, fromId);
    const into = await this.row(tenantId, intoId);
    await this.handle.db.transaction(async (tx) => {
      await tx.update(appointments).set({ customerId: intoId }).where(and(eq(appointments.tenantId, tenantId), eq(appointments.customerId, fromId)));
      await tx.update(messageLog).set({ customerId: intoId }).where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.customerId, fromId)));
      await tx.update(waitlistEntries).set({ customerId: intoId }).where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.customerId, fromId)));
      await tx
        .update(customers)
        .set({
          noShowCount: into.noShowCount + from.noShowCount, lateCancelCount: into.lateCancelCount + from.lateCancelCount,
          tags: [...new Set([...into.tags, ...from.tags])], email: into.email ?? from.email, birthday: into.birthday ?? from.birthday,
          consentWhatsapp: into.consentWhatsapp || from.consentWhatsapp, updatedAt: this.clock.now(),
        })
        .where(eq(customers.id, intoId));
      await tx
        .update(customers)
        .set({ deletedAt: this.clock.now(), mergedInto: intoId, phoneE164: `${from.phoneE164}#merged-${from.id.slice(0, 8)}`, updatedAt: this.clock.now() })
        .where(eq(customers.id, fromId));
    });
    return this.get(tenantId, intoId);
  }

  async messages(tenantId: string, id: string): Promise<MessageDto[]> {
    const c = await this.row(tenantId, id);
    const rows = await this.handle.db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.phoneE164, c.phoneE164)))
      .orderBy(desc(messageLog.createdAt))
      .limit(50);
    return rows.map(toMessageDto);
  }
}
