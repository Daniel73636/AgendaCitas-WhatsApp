'use client';
import type { AppointmentDto } from '@agenda/contracts';
import { canTransition } from '@agenda/domain-booking';
import { Badge, Button, Field, Input, Modal, Select, Textarea, cn } from '@agenda/ui';
import { Check, CheckCircle2, Clock, LogIn, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { STATUS_META, fmtTime, fromCents, money, toCents } from '@/lib/format';
import { useApiMutation, useAuthed } from '@/lib/panel';

export const StatusBadge = ({ status }: { status: AppointmentDto['status'] }) => <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>;

const INVALIDATE = [['appointments'], ['today'], ['unconfirmed'], ['customers'], ['report']];

/** Mutaciones de estado compartidas (check-in, completar, no-show, cancelar). Envian If-Match con la version. */
export function useAptMutations() {
  const base = (path: string, success: string, bodyFn?: (a: AppointmentDto) => unknown) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useApiMutation(
      (a: AppointmentDto & { _body?: unknown }, { token }) => api<AppointmentDto>(`/v1/appointments/${a.id}/${path}`, { method: 'POST', token, headers: { 'If-Match': String(a.version) }, body: a._body ?? bodyFn?.(a) ?? {} }),
      { invalidate: INVALIDATE, success },
    );
  return {
    checkIn: base('check-in', 'Cliente en el local'),
    noShow: base('no-show', 'Marcada como inasistencia'),
    complete: base('complete', 'Cita completada y cobrada'),
    cancel: base('cancel', 'Cita cancelada'),
  };
}

export function CompleteDialog({ apt, open, onClose, onDone }: { apt: AppointmentDto; open: boolean; onClose: () => void; onDone?: () => void }) {
  const { currency } = useAuthed();
  const m = useAptMutations();
  const due = Math.max(0, apt.totalCents - apt.depositPaidCents);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(fromCents(due));
  const cents = toCents(amount);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Completar y cobrar"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={m.complete.isPending} onClick={() => m.complete.mutate({ ...apt, _body: { paymentMethod: method, amountCents: cents } } as never, { onSuccess: () => { onClose(); onDone?.(); } })}>Registrar cobro</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-xl bg-muted p-3">
          <div className="flex justify-between"><span>Total</span><b className="tabular-nums">{money(apt.totalCents, currency)}</b></div>
          {apt.depositPaidCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Anticipo pagado</span><span className="tabular-nums">- {money(apt.depositPaidCents, currency)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Por cobrar</span><span className="tabular-nums">{money(due, currency)}</span></div>
        </div>
        <Field label="Metodo de pago">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option><option value="other">Otro</option>
          </Select>
        </Field>
        <Field label="Monto cobrado ahora" hint="Se guarda en centavos enteros, sin decimales flotantes.">
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function CancelDialog({ apt, open, onClose }: { apt: AppointmentDto; open: boolean; onClose: () => void }) {
  const m = useAptMutations();
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancelar cita"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Volver</Button>
          <Button variant="destructive" loading={m.cancel.isPending} onClick={() => m.cancel.mutate({ ...apt, _body: { reason: reason || undefined, notifyCustomer: notify } } as never, { onSuccess: onClose })}>Cancelar cita</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">El horario se libera y, si hay lista de espera, se ofrece al primero de la fila. {apt.depositPaidCents > 0 && 'El anticipo se devuelve completo (cancela el negocio).'}</p>
      <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[hsl(var(--primary))]" /> Avisar al cliente por WhatsApp</label>
    </Modal>
  );
}

/** Fila de cita con acciones rapidas segun el estado. */
export function AppointmentRow({ apt, showStaff = true, compact }: { apt: AppointmentDto; showStaff?: boolean; compact?: boolean }) {
  const { tz, currency } = useAuthed();
  const m = useAptMutations();
  const [completing, setCompleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const meta = STATUS_META[apt.status];
  const active = ['pending', 'confirmed', 'in_progress'].includes(apt.status);
  return (
    <div className={cn('rounded-2xl border bg-card p-3 shadow-sm transition', meta.border.replace('border-', 'border-l-4 border-l-'), 'border-border')}>
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 text-center">
          <p className="text-base font-bold tabular-nums">{fmtTime(apt.startsAt, tz)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{fmtTime(apt.endsAt, tz)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/citas/${apt.id}`} className="block font-semibold leading-tight hover:underline">{apt.customerName ?? 'Sin cliente'}</Link>
          <p className="truncate text-sm text-muted-foreground">{apt.items.map((i) => i.name).join(' + ')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={apt.status} />
            {showStaff && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: apt.staffColor }} />{apt.staffName.split(' ')[0]}</span>}
            {apt.status === 'confirmed' && !apt.confirmedByCustomer && <Badge tone="warning"><Clock size={11} /> Sin confirmar</Badge>}
            {apt.customerNoShows >= 2 && <Badge tone="danger">{apt.customerNoShows} inasist.</Badge>}
            {apt.depositRequiredCents > 0 && <Badge tone={apt.depositPaidCents >= apt.depositRequiredCents ? 'success' : 'warning'}>Anticipo {money(apt.depositRequiredCents, currency)}</Badge>}
          </div>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{money(apt.totalCents, currency)}</p>
      </div>
      {!compact && active && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {canTransition(apt.status, 'in_progress') && <Button size="sm" variant="outline" loading={m.checkIn.isPending} onClick={() => m.checkIn.mutate(apt)}><LogIn size={14} /> Llego</Button>}
          {canTransition(apt.status, 'completed') && <Button size="sm" onClick={() => setCompleting(true)}><CheckCircle2 size={14} /> Completar</Button>}
          {canTransition(apt.status, 'no_show') && apt.status !== 'in_progress' && <Button size="sm" variant="outline" loading={m.noShow.isPending} onClick={() => m.noShow.mutate(apt)}><UserX size={14} /> No asistio</Button>}
          {apt.status === 'pending' && <PayDepositButton apt={apt} />}
          {canTransition(apt.status, 'canceled') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCanceling(true)}><XCircle size={14} /> Cancelar</Button>}
        </div>
      )}
      {completing && <CompleteDialog apt={apt} open onClose={() => setCompleting(false)} />}
      {canceling && <CancelDialog apt={apt} open onClose={() => setCanceling(false)} />}
    </div>
  );
}

export function PayDepositButton({ apt }: { apt: AppointmentDto }) {
  const pay = useApiMutation((_: void, { token }) => api<AppointmentDto>(`/v1/appointments/${apt.id}/deposit`, { method: 'POST', token, body: {} }), { invalidate: INVALIDATE, success: 'Anticipo registrado: cita confirmada' });
  return <Button size="sm" variant="outline" loading={pay.isPending} onClick={() => pay.mutate()}><Check size={14} /> Registrar anticipo</Button>;
}
