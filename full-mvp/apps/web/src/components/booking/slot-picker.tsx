'use client';
import type { AvailabilityResponse, SlotDto } from '@agenda/contracts';
import { addDaysStr, dayPartOf } from '@agenda/domain-booking';
import { Button, Skeleton, cn } from '@agenda/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight, Moon, Sun, Sunset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { dateLabelFromStr, dayNumber, todayIn, weekdayShort } from '@/lib/format';

const PARTS = [
  { key: 'morning', label: 'Mañana', icon: Sun },
  { key: 'afternoon', label: 'Tarde', icon: Sunset },
  { key: 'evening', label: 'Noche', icon: Moon },
] as const;

export interface SlotPickerProps {
  /** Construye la URL de disponibilidad para un rango [from,to] de fechas locales. null = deshabilitado. */
  buildPath: (from: string, to: string) => string | null;
  /** Clave unica del contexto (servicios+profesional) para la cache. */
  cacheKey: unknown[];
  token?: string | null | undefined;
  tz: string;
  selected: string | null | undefined; // ISO de inicio
  onSelect: (slot: SlotDto) => void;
  /** Se muestra cuando el día elegido no tiene cupo (p. ej. botón de lista de espera). */
  emptyAction?: ((date: string) => React.ReactNode) | undefined;
  /** Profesional concreto, para explicar el estado vacío. */
  emptyStaffName?: string | undefined;
  initialDate?: string | undefined;
  staffNames?: Record<string, string> | undefined;
  showStaff?: boolean | undefined;
}

/** SlotPicker: tira de 7 dias desplazable + cuadricula de horas por franja. Dias sin cupo atenuados con sugerencia de proxima fecha. */
export function SlotPicker({ buildPath, cacheKey, token, tz, selected, onSelect, emptyAction, emptyStaffName, initialDate, staffNames, showStaff }: SlotPickerProps) {
  const today = todayIn(tz);
  const [weekStart, setWeekStart] = useState(initialDate ?? today);
  const [date, setDate] = useState(initialDate ?? today);
  const qc = useQueryClient();

  // Se cargan 14 dias de una vez: la semana visible + la siguiente (pre-carga en segundo plano)
  const from = weekStart;
  const to = addDaysStr(weekStart, 13);
  const path = buildPath(from, to);
  const q = useQuery<AvailabilityResponse>({
    queryKey: ['avail', ...cacheKey, from],
    queryFn: () => api<AvailabilityResponse>(path!, { token }),
    enabled: !!path,
    staleTime: 20_000,
    placeholderData: (p) => p,
  });

  // Pre-carga de la ventana siguiente
  useEffect(() => {
    const next = addDaysStr(weekStart, 7);
    const p = buildPath(next, addDaysStr(next, 13));
    if (p && q.data) void qc.prefetchQuery({ queryKey: ['avail', ...cacheKey, next], queryFn: () => api<AvailabilityResponse>(p, { token }), staleTime: 20_000 });
  }, [weekStart, q.data, qc, buildPath, cacheKey, token]);

  const byDay = useMemo(() => {
    const m = new Map<string, SlotDto[]>();
    for (const s of q.data?.slots ?? []) (m.get(s.date) ?? m.set(s.date, []).get(s.date)!).push(s);
    return m;
  }, [q.data]);

  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  const firstWithSlots = [...byDay.keys()].sort()[0];
  const next = [...byDay.keys()].sort().find((d) => d > date) ?? q.data?.nextAvailableDate ?? null;
  const daySlots = byDay.get(date) ?? [];

  // Si el dia elegido no tiene cupo y existe uno cercano, no se salta solo: se sugiere con un boton
  useEffect(() => {
    if (q.data && !byDay.has(date) && firstWithSlots && date === (initialDate ?? today) && !selected) setDate(firstWithSlots);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = PARTS.map((p) => ({ ...p, slots: daySlots.filter((s) => dayPartOf(s.label) === p.key) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Semana anterior"
          disabled={weekStart <= today}
          onClick={() => {
            const prev = addDaysStr(weekStart, -7);
            setWeekStart(prev < today ? today : prev);
          }}
          className="rounded-full p-2 hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="no-scrollbar flex flex-1 snap-x gap-1.5 overflow-x-auto" role="tablist" aria-label="Días">
          {days.map((d) => {
            const count = byDay.get(d)?.length ?? 0;
            const active = d === date;
            return (
              <button
                key={d}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setDate(d)}
                className={cn(
                  'flex min-w-[3.4rem] flex-1 snap-start flex-col items-center rounded-2xl border px-2 py-2 text-center transition',
                  active ? 'border-primary bg-primary text-primary-foreground shadow' : 'border-border bg-card',
                  !active && count === 0 && q.data && 'opacity-40',
                )}
              >
                <span className="text-[11px] uppercase tracking-wide">{weekdayShort(d)}</span>
                <span className="text-lg font-bold leading-tight">{dayNumber(d)}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', count > 0 ? (active ? 'bg-white' : 'bg-success') : 'bg-transparent')} />
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Semana siguiente" onClick={() => setWeekStart(addDaysStr(weekStart, 7))} className="rounded-full p-2 hover:bg-muted">
          <ChevronRight size={18} />
        </button>
      </div>

      <p className="text-sm font-medium first-letter:uppercase text-muted-foreground">{dateLabelFromStr(date)}</p>

      {q.isError && (
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800" role="alert">
          <p className="font-medium">No pudimos cargar los horarios</p>
          <p>{(q.error as Error).message || 'Revisa tu conexión e intenta de nuevo.'}</p>
          <Button type="button" variant="outline" className="min-h-11 bg-card" loading={q.isFetching} onClick={() => void q.refetch()}>Reintentar</Button>
        </div>
      )}

      {(q.isLoading || (q.isFetching && !q.data)) && !q.isError ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Cargando horarios">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : !q.isError && daySlots.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-8 text-center" role="status">
          <CalendarX2 className="text-muted-foreground" />
          <div>
            <p className="font-medium">
              {byDay.size === 0 && !next
                ? (emptyStaffName ? `Sin cupos con ${emptyStaffName} en estas dos semanas` : 'No hay horarios en estas dos semanas')
                : (emptyStaffName ? `Sin cupos con ${emptyStaffName} este día` : 'No hay horarios este día')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {next
                ? 'Los días atenuados no tienen cupo. Elige uno con el punto verde o salta a la próxima fecha.'
                : 'Prueba con otro profesional o déjanos tu celular: te avisamos si se libera un horario.'}
            </p>
          </div>
          {next && (
            <button type="button" onClick={() => { setDate(next); if (next > addDaysStr(weekStart, 6)) setWeekStart(next); }} className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Próxima fecha disponible: <span className="cap-first inline-block">{dateLabelFromStr(next)}</span>
            </button>
          )}
          {emptyAction?.(date)}
        </div>
      ) : q.data && daySlots.length > 0 ? (
        <div className={cn('flex flex-col gap-4 transition-opacity', q.isFetching && 'opacity-70')}>
          {grouped.filter((g) => g.slots.length > 0).map((g) => (
            <section key={g.key}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <g.icon size={14} /> {g.label}
              </h4>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {g.slots.map((s) => {
                  const active = selected === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => onSelect(s)}
                      aria-pressed={active}
                      className={cn(
                        'flex h-11 flex-col items-center justify-center rounded-xl border text-sm font-medium tabular-nums transition',
                        active ? 'border-primary bg-primary text-primary-foreground shadow' : 'border-border bg-card hover:border-primary/60 hover:bg-secondary',
                      )}
                    >
                      {s.label}
                      {showStaff && staffNames?.[s.staffId] && <span className="-mt-0.5 text-[10px] font-normal opacity-80">{staffNames[s.staffId]!.split(' ')[0]}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
