'use client';
import type { AppointmentDto, MessageDto, SlotDto } from '@agenda/contracts';
import { canTransition } from '@agenda/domain-booking';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Modal, Skeleton, Switch, Textarea } from '@agenda/ui';
import { ArrowLeft, CalendarClock, CheckCircle2, Copy, LogIn, MessageCircle, Phone, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { SlotPicker } from '@/components/booking/slot-picker';
import { CancelDialog, CompleteDialog, PayDepositButton, StatusBadge, useAptMutations } from '@/components/panel/apt-actions';
import { api } from '@/lib/api';
import { fmtDateLong, fmtDateTime, fmtTime, money, waLink } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';
import { toast } from '@/lib/session';

type Detail = AppointmentDto & { token: string };

export default function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tz, currency, slug, token } = useAuthed();
  const q = usePQuery<Detail>(['appointments', 'detail', id], `/v1/appointments/${id}`, { staleTime: 3_000 });
  const msgs = usePQuery<MessageDto[]>(['appointments', 'messages', id], `/v1/appointments/${id}/messages`, { staleTime: 3_000 });
  const m = useAptMutations();
  const [completing, setCompleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [moving, setMoving] = useState(false);
  const [notes, setNotes] = useState('');
  const apt = q.data;
  useEffect(() => { if (apt) setNotes(apt.notes ?? ''); }, [apt?.id, apt?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = useApiMutation((_: void, { token }) => api<AppointmentDto>(`/v1/appointments/${id}`, { method: 'PATCH', token, headers: { 'If-Match': String(apt!.version) }, body: { notes } }), { invalidate: [['appointments']], success: 'Notas guardadas' });
  const simulate = useApiMutation((action: 'confirm' | 'cancel' | 'reschedule', { token }) => api<{ reply: string }>('/v1/webhooks/whatsapp/simulate-button', { method: 'POST', token, body: { appointmentId: id, action } }), { invalidate: [['appointments'], ['conversations']], success: 'Respuesta del cliente simulada' });

  if (q.isLoading) return <div className="mx-auto max-w-3xl space-y-3"><Skeleton className="h-10" /><Skeleton className="h-48" /></div>;
  if (q.isError || !apt) return <EmptyState icon={<XCircle />} title="Cita no encontrada" description={q.error?.message} action={<Link href="/calendario" className="text-primary">Volver al calendario</Link>} />;
  const active = ['pending', 'confirmed', 'in_progress'].includes(apt.status);
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/${slug}/cita/${apt.token}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/calendario" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Calendario</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm first-letter:uppercase text-muted-foreground">{fmtDateLong(apt.startsAt, tz)}</p>
          <h1 className="text-2xl font-bold">{fmtTime(apt.startsAt, tz)} – {fmtTime(apt.endsAt, tz)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={apt.status} />
            {apt.confirmedByCustomer && <Badge tone="success"><CheckCircle2 size={12} /> Confirmo asistencia</Badge>}
            <Badge>{apt.source}</Badge>
            <span className="text-xs text-muted-foreground">v{apt.version}</span>
          </div>
        </div>
        {active && (
          <div className="flex flex-wrap gap-2">
            {canTransition(apt.status, 'in_progress') && <Button variant="outline" loading={m.checkIn.isPending} onClick={() => m.checkIn.mutate(apt)}><LogIn size={16} /> Llego</Button>}
            {canTransition(apt.status, 'completed') && <Button onClick={() => setCompleting(true)}><CheckCircle2 size={16} /> Completar y cobrar</Button>}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cliente</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {apt.customerId ? (
              <>
                <Link href={`/clientes/${apt.customerId}`} className="text-base font-semibold text-primary hover:underline">{apt.customerName}</Link>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone size={14} /> {apt.customerPhone}</p>
                {apt.customerNoShows >= 1 && <Badge tone="danger">{apt.customerNoShows} inasistencia(s) previas</Badge>}
                <div className="mt-1 flex gap-2">
                  {apt.customerPhone && <a href={waLink(apt.customerPhone)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted"><MessageCircle size={14} /> Abrir WhatsApp</a>}
                  {apt.customerPhone && <Link href={`/mensajes?phone=${encodeURIComponent(apt.customerPhone)}`} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted">Ver chat</Link>}
                </div>
              </>
            ) : <p className="text-muted-foreground">Reserva temporal sin datos de cliente.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Servicios y pago</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {apt.items.map((i) => <div key={i.id} className="flex justify-between"><span>{i.name} <span className="text-muted-foreground">· {i.durationMin} min</span></span><span className="tabular-nums">{money(i.priceCents, currency)}</span></div>)}
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(apt.totalCents, currency)}</span></div>
            {apt.depositRequiredCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Anticipo ({apt.depositPaidCents >= apt.depositRequiredCents ? 'pagado' : 'pendiente'})</span><span className="tabular-nums">{money(apt.depositRequiredCents, currency)}</span></div>}
            {apt.status === 'completed' && <div className="flex justify-between text-success"><span>Cobrado ({apt.paymentMethod})</span><span className="tabular-nums">{money(apt.paidCents, currency)}</span></div>}
            {apt.refundedCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Devuelto</span><span className="tabular-nums">{money(apt.refundedCents, currency)}</span></div>}
            <p className="text-xs text-muted-foreground">Atiende: <span className="font-medium text-foreground">{apt.staffName}</span></p>
          </CardContent>
        </Card>
      </div>

      {active && (
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMoving(true)}><CalendarClock size={16} /> Reprogramar</Button>
            {apt.status === 'pending' && <PayDepositButton apt={apt} />}
            {canTransition(apt.status, 'no_show') && apt.status !== 'in_progress' && <Button variant="outline" loading={m.noShow.isPending} onClick={() => m.noShow.mutate(apt)}><UserX size={16} /> No asistio</Button>}
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast.success('Enlace de la cita copiado'); }}><Copy size={16} /> Copiar enlace del cliente</Button>
            <Button variant="ghost" className="ml-auto text-destructive" onClick={() => setCanceling(true)}><XCircle size={16} /> Cancelar</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Demo WhatsApp (modo mock):</span> simular que el cliente toca
            <Button size="sm" variant="outline" loading={simulate.isPending} onClick={() => simulate.mutate('confirm')}>“Confirmo”</Button>
            <Button size="sm" variant="outline" onClick={() => simulate.mutate('cancel')}>“Cancelar”</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Notas internas</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferencias, alergias, indicaciones..." />
          <div><Button size="sm" variant="outline" disabled={notes === (apt.notes ?? '')} loading={saveNotes.isPending} onClick={() => saveNotes.mutate()}>Guardar notas</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Historial de mensajes</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {msgs.data?.length === 0 && <p className="text-sm text-muted-foreground">Aun no se han enviado mensajes por esta cita.</p>}
          {msgs.data?.map((mm) => (
            <div key={mm.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">{mm.direction === 'out' ? '➡️ Enviado' : '⬅️ Recibido'}{mm.template && <Badge tone="primary">{mm.template}</Badge>}</span>
                <span>{fmtDateTime(mm.createdAt, tz)} · <Badge tone={mm.status === 'failed' ? 'danger' : 'success'}>{mm.status}</Badge></span>
              </div>
              <p className="whitespace-pre-wrap">{mm.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {completing && <CompleteDialog apt={apt} open onClose={() => setCompleting(false)} />}
      {canceling && <CancelDialog apt={apt} open onClose={() => setCanceling(false)} />}
      {moving && <RescheduleDialog apt={apt} onClose={() => setMoving(false)} />}
      {token && null}
    </div>
  );
}

function RescheduleDialog({ apt, onClose }: { apt: Detail; onClose: () => void }) {
  const { tz, token } = useAuthed();
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [outside, setOutside] = useState(false);
  const [manual, setManual] = useState('');
  const mut = useApiMutation(
    (_: void, { token }) => api<AppointmentDto>(`/v1/appointments/${apt.id}`, { method: 'PATCH', token, headers: { 'If-Match': String(apt.version) }, body: { startsAt: slot?.start ?? manual, staffId: slot ? slot.staffId : undefined, ignoreSchedule: outside } }),
    { invalidate: [['appointments']], success: 'Cita reprogramada y cliente notificado', onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Reprogramar cita" size="lg" footer={<Button disabled={!slot && !manual} loading={mut.isPending} onClick={() => mut.mutate()}>{slot ? `Mover a ${fmtDateLong(slot.start, tz)} ${slot.label}` : 'Mover'}</Button>}>
      <div className="flex flex-col gap-4">
        <SlotPicker
          tz={tz} token={token} cacheKey={['resched', apt.id]} selected={slot?.start} onSelect={setSlot}
          buildPath={(from, to) => `/v1/availability?serviceIds=${apt.items.map((i) => i.serviceId).join(',')}&staffId=${apt.staffId}&from=${from}&to=${to}&excludeAppointmentId=${apt.id}`}
        />
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Hora manual (sobrecupo)</summary>
          <div className="mt-3 flex flex-col gap-3">
            <input type="datetime-local" className="h-10 rounded-xl border border-border px-3" onChange={(e) => { setSlot(null); setManual(e.target.value ? new Date(e.target.value).toISOString() : ''); }} />
            <Switch checked={outside} onChange={setOutside} label="Permitir fuera de horario (nunca se permiten solapes)" />
          </div>
        </details>
      </div>
    </Modal>
  );
}
