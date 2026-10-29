'use client';
import type { AppointmentDto, ReportSummary } from '@agenda/contracts';
import { addDaysStr } from '@agenda/domain-booking';
import { Button, Card, EmptyState, Skeleton, Stat } from '@agenda/ui';
import { AlertTriangle, ArrowRight, BellRing, CalendarCheck, CheckCircle2, Rocket, Sparkles, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { AppointmentRow, PayDepositButton } from '@/components/panel/apt-actions';
import { QuickBookButton } from '@/components/panel/new-appointment-dialog';
import { api } from '@/lib/api';
import { dateLabelFromStr, dayEndIso, dayStartIso, fmtDateShort, fmtTime, money, todayIn } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

export default function TodayPage() {
  const { tz, currency, user, tenantId } = useAuthed();
  const today = todayIn(tz);
  const now = useMemo(() => new Date(), []);
  const list = usePQuery<AppointmentDto[]>(['appointments', 'today', today], `/v1/appointments?from=${encodeURIComponent(dayStartIso(today, tz))}&to=${encodeURIComponent(dayEndIso(today, tz))}`);
  const unconfirmed = usePQuery<AppointmentDto[]>(['appointments', 'unconfirmed'], `/v1/appointments/unconfirmed?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(new Date(now.getTime() + 48 * 3_600_000).toISOString())}`);
  const summary = usePQuery<ReportSummary>(['report', 'summary', 'home'], `/v1/reports/summary?from=${addDaysStr(today, -29)}&to=${today}`, { staleTime: 60_000 });

  const apts = (list.data ?? []).filter((a) => a.status !== 'canceled' && a.status !== 'held');
  const upcoming = apts.filter((a) => ['pending', 'confirmed', 'in_progress'].includes(a.status));
  const done = apts.filter((a) => ['completed', 'no_show'].includes(a.status));
  const next = upcoming.find((a) => Date.parse(a.endsAt) > Date.now());
  const expected = apts.filter((a) => a.status !== 'no_show').reduce((s, a) => s + a.totalCents, 0);
  const collected = apts.filter((a) => a.status === 'completed').reduce((s, a) => s + a.paidCents, 0);
  const confirmedCount = apts.filter((a) => a.status === 'confirmed' && a.confirmedByCustomer).length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm first-letter:uppercase text-muted-foreground">{dateLabelFromStr(today)}</p>
          <h1 className="text-2xl font-bold">Hola, {user?.name.split(' ')[0] ?? ''} 👋</h1>
        </div>
        <QuickBookButton />
      </div>

      <OnboardingChecklist key={tenantId} />
      <ImpactBanner s={summary.data} currency={currency} />

      {/* KpiCards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {list.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <Stat label="Citas de hoy" value={apts.length} hint={`${done.length} terminadas · ${upcoming.length} por atender`} />
            <Stat label="Confirmadas por el cliente" value={`${confirmedCount}/${upcoming.length + done.filter((d) => d.status === 'completed').length || 0}`} hint="Respondieron al recordatorio" tone={(unconfirmed.data?.length ?? 0) > 0 ? 'warning' : 'default'} />
            <Stat label="Ingresos del dia" value={money(collected, currency)} hint={`Esperado: ${money(expected, currency)}`} />
            <Stat label="Proxima cita" value={next ? fmtTime(next.startsAt, tz) : '—'} hint={next ? `${next.customerName ?? ''} · ${next.staffName.split(' ')[0]}` : 'Sin citas pendientes'} />
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        {/* TodayTimeline */}
        <section aria-labelledby="timeline" className="flex flex-col gap-3">
          <h2 id="timeline" className="text-lg font-semibold">Agenda de hoy</h2>
          {list.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          {list.isError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{list.error.message}</p>}
          {list.data && apts.length === 0 && (
            <EmptyState icon={<CalendarCheck size={32} />} title="Hoy no hay citas" description="Crea una cita manual o comparte tu pagina de reservas para recibir clientes." action={<QuickBookButton label="Crear cita" />} />
          )}
          {upcoming.map((a) => <AppointmentRow key={a.id} apt={a} />)}
          {done.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Terminadas ({done.length})</summary>
              <div className="mt-2 flex flex-col gap-2">{done.map((a) => <AppointmentRow key={a.id} apt={a} compact />)}</div>
            </details>
          )}
        </section>

        {/* UnconfirmedAlerts */}
        <aside className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><BellRing size={18} className="text-warning" /> Por confirmar</h2>
          {unconfirmed.isLoading && <Skeleton className="h-24" />}
          {unconfirmed.data?.length === 0 && <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><CheckCircle2 size={18} className="text-success" /> Todo confirmado para las proximas 48 h.</Card>}
          {unconfirmed.data?.map((a) => <UnconfirmedAlert key={a.id} apt={a} />)}
        </aside>
      </div>
    </div>
  );
}

function UnconfirmedAlert({ apt }: { apt: AppointmentDto }) {
  const { tz, currency } = useAuthed();
  const remind = useApiMutation(
    (_: void, { token }) =>
      api('/v1/messages/reply', {
        method: 'POST', token,
        body: { phone: apt.customerPhone, appointmentId: apt.id, body: `Hola ${apt.customerName?.split(' ')[0]}, te recordamos tu cita ${fmtDateShort(apt.startsAt, tz)} a las ${fmtTime(apt.startsAt, tz)}. ¿Nos confirmas tu asistencia? Responde SI para confirmar.` },
      }),
    { success: 'Recordatorio enviado por WhatsApp' },
  );
  return (
    <Card className="border-warning/50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{apt.customerName}</p>
          <p className="text-muted-foreground">{fmtDateShort(apt.startsAt, tz)} · {fmtTime(apt.startsAt, tz)} · {apt.items[0]?.name}</p>
          <p className="text-xs text-warning-foreground">{apt.status === 'pending' ? `Falta anticipo de ${money(apt.depositRequiredCents, currency)}` : 'El cliente aun no confirma'}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {apt.status === 'pending' ? <PayDepositButton apt={apt} /> : <Button size="sm" variant="outline" loading={remind.isPending} onClick={() => remind.mutate()}>Pedir confirmacion</Button>}
        <Link href={`/citas/${apt.id}`} className="inline-flex h-8 items-center rounded-xl px-3 text-xs font-medium hover:bg-muted">Ver</Link>
      </div>
    </Card>
  );
}

/** ImpactBanner: valor generado por los recordatorios (con el supuesto explicito). */
function ImpactBanner({ s, currency }: { s?: ReportSummary | undefined; currency: string }) {
  if (!s) return <Skeleton className="h-24" />;
  const i = s.impact;
  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-0 text-white">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/20 p-2"><Sparkles size={20} /></div>
          <div>
            <p className="font-semibold">Tus recordatorios de WhatsApp (ultimos 30 dias)</p>
            <p className="text-sm text-white/80">Estimado con el supuesto de que {(i.assumption * 100).toFixed(0)}% de las citas recordadas habrian sido inasistencias.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-2xl font-bold tabular-nums">{i.appointmentsReminded}</p><p className="text-[11px] text-white/80">citas recordadas</p></div>
          <div><p className="text-2xl font-bold tabular-nums">{i.estimatedNoShowsAvoided}</p><p className="text-[11px] text-white/80">inasistencias evitadas</p></div>
          <div><p className="text-xl font-bold tabular-nums sm:text-2xl">{money(i.estimatedRecoveredCents, currency)}</p><p className="text-[11px] text-white/80">dinero recuperado</p></div>
        </div>
      </div>
    </Card>
  );
}

/** OnboardingChecklist: desaparece al completarse. */
function OnboardingChecklist() {
  const q = usePQuery<{ steps: Array<{ key: string; label: string; done: boolean; href: string }>; complete: boolean }>(['onboarding'], '/v1/tenant/onboarding', { staleTime: 30_000 });
  const dismiss = useApiMutation((_: void, { token }) => api('/v1/tenant', { method: 'PATCH', token, body: { settings: { onboardingDismissed: true } } }), { invalidate: [['onboarding']] });
  if (!q.data || q.data.complete) return null;
  const done = q.data.steps.filter((s) => s.done).length;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Rocket size={16} className="text-primary" /> Pon en marcha tu agenda ({done}/{q.data.steps.length})</p>
        <button aria-label="Ocultar" onClick={() => dismiss.mutate()} className="text-muted-foreground"><X size={16} /></button>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${(done / q.data.steps.length) * 100}%` }} /></div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {q.data.steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted">
              <span className="flex items-center gap-2">{s.done ? <CheckCircle2 size={16} className="text-success" /> : <span className="h-4 w-4 rounded-full border-2 border-border" />}<span className={s.done ? 'text-muted-foreground line-through' : ''}>{s.label}</span></span>
              {!s.done && <ArrowRight size={14} className="text-primary" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
