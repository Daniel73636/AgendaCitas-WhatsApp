'use client';
import type { PublicAppointmentDto, SlotDto } from '@agenda/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Textarea } from '@agenda/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarClock, MessageCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { AppointmentSummary } from '@/components/booking/appointment-summary';
import { SlotPicker } from '@/components/booking/slot-picker';
import { ApiError, api } from '@/lib/api';
import { fmtDateLong, fmtTime, money, waLink } from '@/lib/format';
import { toast } from '@/lib/session';

export default function ManageAppointmentPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(params);
  const qc = useQueryClient();
  const q = useQuery<PublicAppointmentDto, ApiError>({
    queryKey: ['public-apt', token],
    queryFn: () => api<PublicAppointmentDto>(`/v1/public/appointments/${token}`),
    refetchInterval: 30_000,
    retry: false,
  });
  const [mode, setMode] = useState<'none' | 'reschedule' | 'cancel'>('none');
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alternatives, setAlternatives] = useState<SlotDto[]>([]);

  const apt = q.data;
  const set = (a: PublicAppointmentDto) => qc.setQueryData(['public-apt', token], a);

  async function act<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(ok);
      setMode('none');
      setSlot(null);
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.alternatives?.length) setAlternatives(e.alternatives);
      toast.error(e instanceof Error ? e.message : 'No se pudo completar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl pb-10">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur">
        <Link href={`/${slug}`} aria-label="Ir al negocio" className="rounded-full p-2 hover:bg-muted"><ArrowLeft size={20} /></Link>
        <h1 className="text-lg font-semibold">Tu cita</h1>
      </header>
      <div className="flex flex-col gap-4 p-4">
        {q.isLoading && <><Skeleton className="h-40" /><Skeleton className="h-24" /></>}
        {q.isError && <EmptyState icon={<XCircle />} title="No encontramos esta cita" description={q.error.message} action={<Link href={`/${slug}`} className="text-sm font-medium text-primary">Ir al negocio</Link>} />}
        {apt && (
          <>
            {apt.status === 'canceled' && <Card className="flex items-center gap-2 border-red-200 bg-red-50 p-3 text-sm text-red-700"><XCircle size={18} /> Esta cita fue cancelada.</Card>}
            {apt.status === 'held' && (
              <Card className="border-primary/40 bg-secondary p-4">
                <p className="font-semibold">Hay un cupo reservado para ti</p>
                <p className="mb-3 text-sm text-muted-foreground">Se libero este horario de la lista de espera. Aceptalo antes de que venza ({apt.holdExpiresAt ? `hasta las ${fmtTime(apt.holdExpiresAt, apt.business.timezone)}` : ''}).</p>
                <Button className="w-full" loading={busy} onClick={async () => { const r = await act(() => api<PublicAppointmentDto>(`/v1/public/appointments/${token}/accept`, { method: 'POST' }), '¡Cupo confirmado!'); if (r) set(r); }}>Lo quiero</Button>
              </Card>
            )}
            {apt.status === 'pending' && (
              <Card className="border-warning/50 bg-warning/10 p-4">
                <p className="font-semibold">Pendiente de anticipo: {money(apt.depositRequiredCents, apt.currency)}</p>
                <Button className="mt-2 w-full" loading={busy} onClick={async () => { const r = await act(() => api<PublicAppointmentDto>(`/v1/public/appointments/${token}/pay`, { method: 'POST' }), 'Pago recibido');  if (r) set(r); }}>Pagar anticipo (simulado)</Button>
              </Card>
            )}
            <AppointmentSummary apt={apt} />

            {(apt.status === 'confirmed' || apt.status === 'pending') && (
              <Card className="flex flex-col gap-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" disabled={!apt.policy.canReschedule} onClick={() => setMode('reschedule')}><CalendarClock size={16} /> Reprogramar</Button>
                  <Button variant="outline" className="text-destructive" disabled={!apt.policy.canCancel} onClick={() => setMode('cancel')}><XCircle size={16} /> Cancelar</Button>
                </div>
                {(!apt.policy.canCancel || !apt.policy.canReschedule) && (
                  <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {apt.policy.cancelReason ?? apt.policy.rescheduleReason}
                    {apt.business.phone && <a className="ml-1 font-medium text-primary" href={waLink(apt.business.phone, 'Hola, necesito modificar mi cita')}>Escribir al negocio</a>}
                  </p>
                )}
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><MessageCircle size={13} /> Recibiras un mensaje de WhatsApp con cada cambio.</p>
              </Card>
            )}
          </>
        )}
      </div>

      <Modal
        open={mode === 'reschedule' && !!apt}
        onClose={() => setMode('none')}
        title="Elige un nuevo horario"
        footer={
          <Button
            loading={busy}
            disabled={!slot}
            onClick={async () => {
              const r = await act(() => api<PublicAppointmentDto>(`/v1/public/appointments/${token}/reschedule`, { method: 'POST', body: { startsAt: slot!.start, staffId: slot!.staffIds.includes(apt!.staffId) ? apt!.staffId : 'any' } }), 'Cita reprogramada');
              if (r) set(r);
            }}
          >
            {slot ? `Confirmar ${fmtDateLong(slot.start, apt?.business.timezone ?? 'America/Bogota')} ${slot.label}` : 'Elige un horario'}
          </Button>
        }
      >
        {apt && (
          <>
            <SlotPicker
              tz={apt.business.timezone}
              cacheKey={['resched', token]}
              buildPath={(from, to) => `/v1/public/${slug}/availability?serviceIds=${apt.services.map((s) => s.id).join(',')}&staffId=any&from=${from}&to=${to}`}
              selected={slot?.start}
              onSelect={setSlot}
            />
            {alternatives.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {alternatives.map((a) => <button key={a.start} onClick={() => setSlot(a)} className="rounded-xl border border-border px-3 py-1.5 text-sm">{fmtDateLong(a.start, apt.business.timezone)} {a.label}</button>)}
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={mode === 'cancel'}
        onClose={() => setMode('none')}
        title="¿Cancelar tu cita?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode('none')}>Volver</Button>
            <Button variant="destructive" loading={busy} onClick={async () => { const r = await act(() => api<PublicAppointmentDto>(`/v1/public/appointments/${token}/cancel`, { method: 'POST', body: { reason: reason || undefined } }), 'Cita cancelada'); if (r) set(r); }}>Si, cancelar</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">Liberaremos tu horario para otra persona. {apt && apt.depositPaidCents > 0 && 'Tu anticipo se devolvera segun la politica del negocio.'}</p>
        <Textarea placeholder="Cuentanos el motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </main>
  );
}
