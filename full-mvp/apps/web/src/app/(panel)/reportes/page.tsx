'use client';
import type { NoShowReport, OccupancyReport, ReportSummary, RevenueReport } from '@agenda/contracts';
import { addDaysStr } from '@agenda/domain-booking';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Stat, cn } from '@agenda/ui';
import { useState } from 'react';
import { dayNumber, money, todayIn, weekdayShortN } from '@/lib/format';
import { useAuthed, usePQuery } from '@/lib/panel';

const RANGES = [{ days: 7, label: '7 dias' }, { days: 30, label: '30 dias' }, { days: 90, label: '90 dias' }];

export default function ReportsPage() {
  const { tz, currency } = useAuthed();
  const [days, setDays] = useState(30);
  const to = todayIn(tz);
  const qs = `from=${addDaysStr(to, -(days - 1))}&to=${to}`;
  const sum = usePQuery<ReportSummary>(['report', 'summary', days], `/v1/reports/summary?${qs}`, { staleTime: 30_000 });
  const rev = usePQuery<RevenueReport>(['report', 'revenue', days], `/v1/reports/revenue?${qs}`, { staleTime: 30_000 });
  const occ = usePQuery<OccupancyReport>(['report', 'occupancy', days], `/v1/reports/occupancy?${qs}`, { staleTime: 30_000 });
  const ns = usePQuery<NoShowReport>(['report', 'noshows', days], `/v1/reports/no-shows?${qs}`, { staleTime: 30_000 });
  const s = sum.data;
  const maxDay = Math.max(1, ...(rev.data?.byDay.map((d) => d.cents) ?? [0]));
  const maxRate = Math.max(0.01, ...(ns.data?.byWeekday.map((x) => (x.total ? x.noShows / x.total : 0)) ?? [0]));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reportes</h1>
        <div className="flex rounded-xl bg-muted p-1 text-sm">
          {RANGES.map((r) => <button key={r.days} onClick={() => setDays(r.days)} className={cn('rounded-lg px-3 py-1.5 font-medium', days === r.days && 'bg-card shadow-sm')}>{r.label}</button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!s ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <Stat label="Ingresos" value={money(s.revenueCents, currency)} hint={`Ticket promedio ${money(s.avgTicketCents, currency)}`} />
            <Stat label="Citas" value={s.totals.appointments} hint={`${s.totals.completed} completadas · ${s.totals.canceled} canceladas`} />
            <Stat label="Inasistencia" value={`${(s.noShowRate * 100).toFixed(1)}%`} hint={`${s.totals.noShow} no asistieron`} tone={s.noShowRate > 0.12 ? 'danger' : 'default'} />
            <Stat label="Ocupacion" value={`${s.occupancyPct}%`} hint={`${s.newCustomers} clientes nuevos`} />
          </>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Ingresos por dia</CardTitle></CardHeader>
        <CardContent>
          {!rev.data ? <Skeleton className="h-40" /> : (
            <div className="flex h-44 items-end gap-[3px]" role="img" aria-label="Grafico de ingresos por dia">
              {rev.data.byDay.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${d.date}: ${money(d.cents, currency)} (${d.count} citas)`}>
                  <div className="w-full rounded-t bg-primary/80 transition group-hover:bg-primary" style={{ height: Math.max(2, Math.round((d.cents / maxDay) * 140)) }} />
                  {days <= 30 && <span className="mt-1 text-[9px] text-muted-foreground">{dayNumber(d.date)}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Mapa de calor de ocupacion</CardTitle></CardHeader>
          <CardContent>
            {!occ.data ? <Skeleton className="h-48" /> : <Heatmap data={occ.data.heatmap} />}
            <div className="mt-4 flex flex-col gap-2">
              {occ.data?.byStaff.map((b) => (
                <div key={b.staffId} className="text-sm">
                  <div className="mb-1 flex justify-between"><span>{b.name}</span><span className="tabular-nums text-muted-foreground">{b.pct}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${b.pct}%` }} /></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Inasistencias</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!ns.data ? <Skeleton className="h-40" /> : (
              <>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por dia de la semana</p>
                  <div className="flex h-24 items-end gap-2">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const x = ns.data.byWeekday[d]!;
                      const rate = x.total ? x.noShows / x.total : 0;
                      return (
                        <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${x.noShows} de ${x.total} (${Math.round(rate * 100)}%)`}>
                          <div className="w-full rounded-t bg-destructive/70" style={{ height: Math.max(3, Math.round((rate / maxRate) * 64)) }} />
                          <span className="text-[10px] text-muted-foreground">{weekdayShortN(d)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clientes con mas inasistencias</p>
                  {ns.data.byCustomer.length === 0 ? <p className="text-sm text-muted-foreground">Sin inasistencias en el periodo 🎉</p> : (
                    <ul className="divide-y divide-border text-sm">
                      {ns.data.byCustomer.map((c) => <li key={c.customerId} className="flex justify-between py-1.5"><span>{c.name} <span className="text-xs text-muted-foreground">{c.phone}</span></span><b className="tabular-nums text-destructive">{c.noShows}</b></li>)}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Ingresos por servicio</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm"><tbody className="divide-y divide-border">
              {rev.data?.byService.map((r) => <tr key={r.serviceId}><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right text-muted-foreground tabular-nums">{r.count}</td><td className="py-1.5 text-right font-medium tabular-nums">{money(r.cents, currency)}</td></tr>)}
            </tbody></table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Por profesional (con comisiones)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1">Profesional</th><th className="pb-1 text-right">Ingresos</th><th className="pb-1 text-right">Comision</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rev.data?.byStaff.map((r) => <tr key={r.staffId}><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular-nums">{money(r.cents, currency)}</td><td className="py-1.5 text-right tabular-nums text-muted-foreground">{money(r.commissionCents, currency)}</td></tr>)}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Heatmap({ data }: { data: number[][] }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `2.2rem repeat(${hours.length}, minmax(1.4rem, 1fr))` }} role="img" aria-label="Mapa de calor de ocupacion por dia y hora">
        <span />
        {hours.map((h) => <span key={h} className="text-center text-[10px] text-muted-foreground">{h}</span>)}
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className="contents">
            <span className="self-center text-[11px] text-muted-foreground">{weekdayShortN(d)}</span>
            {hours.map((h) => {
              const v = data[d]?.[h] ?? 0;
              return <span key={h} title={`${weekdayShortN(d)} ${h}:00 — ${Math.round(v * 100)}%`} className="h-6 rounded-[5px]" style={{ backgroundColor: v === 0 ? 'hsl(var(--muted))' : `hsl(262 83% ${95 - v * 45}%)` }} />;
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Mas oscuro = mas ocupado. Gris = fuera de horario.</p>
    </div>
  );
}
