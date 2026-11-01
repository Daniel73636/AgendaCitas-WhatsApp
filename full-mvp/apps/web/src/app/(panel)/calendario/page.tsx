'use client';
import type { AppointmentDto, StaffDto, TimeOffDto } from '@agenda/contracts';
import { addDaysStr } from '@agenda/domain-booking';
import { Button, Select, Skeleton, cn } from '@agenda/ui';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CalendarGrid, type TimeOffLite, type WorkBlockLite } from '@/components/panel/calendar-grid';
import { AgendaList, MonthView, WeekView } from '@/components/panel/calendar-views';
import { NewAppointmentDialog, type NewAppointmentInitial } from '@/components/panel/new-appointment-dialog';
import { dateLabelFromStr, dayEndIso, dayStartIso, isoAt, mondayOf, monthLabel, todayIn } from '@/lib/format';
import { useAuthed, usePQuery } from '@/lib/panel';
import { useCalendarUi } from '@/lib/session';

export default function CalendarPage() {
  const { tz, tenantId } = useAuthed();
  const { view, date, staffFilter, setView, setDate, setStaffFilter } = useCalendarUi();
  const [dialog, setDialog] = useState<NewAppointmentInitial | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  useEffect(() => { if (!date) setDate(todayIn(tz)); }, [date, tz, setDate]);
  const d = date || todayIn(tz);

  const range = view === 'day'
    ? { from: dayStartIso(d, tz), to: dayEndIso(d, tz) }
    : view === 'week'
      ? { from: dayStartIso(mondayOf(d), tz), to: dayStartIso(addDaysStr(mondayOf(d), 7), tz) }
      : { from: dayStartIso(mondayOf(`${d.slice(0, 7)}-01`), tz), to: dayStartIso(addDaysStr(mondayOf(`${d.slice(0, 7)}-01`), 42), tz) };
  const rangeKey = [tenantId, 'appointments', 'range', view, range.from];
  // clave sin el tenant: usePQuery la antepone
  const aptsQ = usePQuery<AppointmentDto[]>(['appointments', 'range', view, range.from], `/v1/appointments?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { staleTime: 5_000 });
  const staffQ = usePQuery<StaffDto[]>(['staff'], '/v1/staff', { staleTime: 60_000 });
  const schedQ = usePQuery<Array<{ staffId: string; weekday: number; start: string; end: string }>>(['schedules'], '/v1/schedules', { staleTime: 60_000 });
  const offQ = usePQuery<TimeOffDto[]>(['time-off'], `/v1/time-off?from=${encodeURIComponent(range.from)}`, { staleTime: 60_000 });

  const staff = (staffQ.data ?? []).filter((s) => s.active && (staffFilter === 'all' || s.id === staffFilter));
  const apts = (aptsQ.data ?? []).filter((a) => staffFilter === 'all' || a.staffId === staffFilter);
  const open = (init: NewAppointmentInitial) => { setDialogKey((k) => k + 1); setDialog(init); };

  const shift = (dir: -1 | 1) => {
    if (view === 'day') setDate(addDaysStr(d, dir));
    else if (view === 'week') setDate(addDaysStr(d, 7 * dir));
    else { const [y, m] = d.split('-').map(Number) as [number, number]; const nd = new Date(Date.UTC(y, m - 1 + dir, 1)); setDate(nd.toISOString().slice(0, 10)); }
  };
  const title = view === 'month' ? monthLabel(d) : view === 'week' ? `Semana del ${dateLabelFromStr(mondayOf(d))}` : dateLabelFromStr(d);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Calendario</h1>
        <div className="flex rounded-xl bg-muted p-1 text-sm">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn('rounded-lg px-3 py-1.5 font-medium', view === v && 'bg-card shadow-sm')}>{v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}</button>
          ))}
        </div>
        <Select aria-label="Filtrar por profesional" className="w-44" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
          <option value="all">Todo el equipo</option>
          {(staffQ.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
        <Button className="hidden md:inline-flex" onClick={() => open({})}><Plus size={16} /> Nueva cita</Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Anterior" onClick={() => shift(-1)}><ChevronLeft size={18} /></Button>
        <Button variant="outline" onClick={() => setDate(todayIn(tz))}>Hoy</Button>
        <Button variant="outline" size="icon" aria-label="Siguiente" onClick={() => shift(1)}><ChevronRight size={18} /></Button>
        <h2 className="ml-2 text-lg font-semibold first-letter:uppercase">{title}</h2>
      </div>

      {(aptsQ.isLoading || staffQ.isLoading) && <Skeleton className="h-96" />}
      {aptsQ.isError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{aptsQ.error.message}</p>}

      {aptsQ.data && staffQ.data && (
        <>
          {view === 'day' && (
            <>
              <div className="hidden md:block">
                {staff.length === 0 ? <p className="text-muted-foreground">No hay profesionales activos.</p> : (
                  <CalendarGrid
                    date={d}
                    staff={staff}
                    appointments={apts}
                    schedules={(schedQ.data ?? []) as WorkBlockLite[]}
                    timeOff={(offQ.data ?? []).map((o) => ({ staffId: o.staffId, startsAt: o.startsAt, endsAt: o.endsAt, isExtraOpening: o.isExtraOpening })) as TimeOffLite[]}
                    queryKey={rangeKey}
                    onCreate={(staffId, startsAt) => open({ staffId, startsAt })}
                  />
                )}
              </div>
              <div className="md:hidden"><AgendaList appointments={apts} staff={staff} date={d} onCreate={(staffId) => open(staffId ? { staffId } : {})} /></div>
            </>
          )}
          {view === 'week' && (
            <WeekView
              date={d}
              appointments={apts}
              onPickDay={(day) => { setDate(day); setView('day'); }}
              onCreate={(day) => open({ startsAt: isoAt(day, 10 * 60, tz) })}
            />
          )}
          {view === 'month' && <MonthView date={d} appointments={apts} onPickDay={(day) => { setDate(day); setView('day'); }} />}
        </>
      )}

      {dialog && <NewAppointmentDialog key={dialogKey} open onClose={() => setDialog(null)} initial={dialog} />}
    </div>
  );
}
