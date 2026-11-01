'use client';
import type { AppointmentDto, StaffDto } from '@agenda/contracts';
import { addDaysStr, weekdayOf } from '@agenda/domain-booking';
import { Button, EmptyState, cn } from '@agenda/ui';
import { CalendarX2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AppointmentRow } from '@/components/panel/apt-actions';
import { STATUS_META, dateLabelFromStr, dayNumber, dayOf, fmtTime, mondayOf, todayIn, weekdayShort } from '@/lib/format';
import { useAuthed } from '@/lib/panel';

/** Vista movil: lista de agenda con pestanas por profesional y swipe horizontal entre ellos. */
export function AgendaList({ appointments, staff, date, onCreate }: { appointments: AppointmentDto[]; staff: StaffDto[]; date: string; onCreate: (staffId?: string) => void }) {
  const [active, setActive] = useState<string | 'all'>('all');
  const startX = useRef<number | null>(null);
  const tabs = [{ id: 'all', name: 'Todos', color: '#7c3aed' }, ...staff.map((s) => ({ id: s.id, name: s.displayName.split(' ')[0]!, color: s.color }))];
  const idx = tabs.findIndex((t) => t.id === active);
  const list = appointments.filter((a) => a.status !== 'canceled' && (active === 'all' || a.staffId === active));
  return (
    <div
      className="flex flex-col gap-3"
      onTouchStart={(e) => { startX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        if (startX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 70) setActive(tabs[Math.max(0, Math.min(tabs.length - 1, idx + (dx < 0 ? 1 : -1)))]!.id);
      }}
    >
      <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => setActive(t.id)} className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium', active === t.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>
            {t.id !== 'all' && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />} {t.name}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<CalendarX2 />} title="Sin citas este día" description={`${dateLabelFromStr(date)}. Desliza para cambiar de profesional.`} action={<Button size="sm" onClick={() => onCreate(active === 'all' ? undefined : active)}><Plus size={14} /> Crear cita</Button>} />
      ) : (
        list.map((a) => <AppointmentRow key={a.id} apt={a} showStaff={active === 'all'} compact />)
      )}
      <button onClick={() => onCreate(active === 'all' ? undefined : active)} aria-label="Nueva cita" className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-xl shadow-primary/40 active:scale-95"><Plus /></button>
    </div>
  );
}

/** Vista semana: 7 columnas con las citas del dia como fichas compactas. */
export function WeekView({ date, appointments, onPickDay, onCreate }: { date: string; appointments: AppointmentDto[]; onPickDay: (d: string) => void; onCreate?: (d: string) => void }) {
  const { tz } = useAuthed();
  const monday = mondayOf(date);
  const today = todayIn(tz);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i));
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => {
        const list = appointments.filter((a) => dayOf(a.startsAt, tz) === d && a.status !== 'canceled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return (
          <div key={d} className={cn('rounded-2xl border bg-card p-2', d === today ? 'border-primary' : 'border-border')}>
            <button onClick={() => onPickDay(d)} className="mb-2 flex w-full items-center justify-between px-1 text-left">
              <span className={cn('text-sm font-semibold first-letter:uppercase', d === today && 'text-primary')}>{weekdayShort(d)} {dayNumber(d)}</span>
              <span className="text-xs text-muted-foreground">{list.length}</span>
            </button>
            <div className="flex flex-col gap-1.5">
              {list.slice(0, 8).map((a) => (
                <Link key={a.id} href={`/citas/${a.id}`} className={cn('block rounded-lg border-l-4 px-2 py-1 text-[11px] leading-tight', STATUS_META[a.status].bg)} style={{ borderLeftColor: a.staffColor }}>
                  <b className="tabular-nums">{fmtTime(a.startsAt, tz)}</b> {a.customerName ?? 'Reserva'}
                  <span className="block truncate text-muted-foreground">{a.items[0]?.name}</span>
                </Link>
              ))}
              {list.length > 8 && <button onClick={() => onPickDay(d)} className="text-left text-xs text-primary">+{list.length - 8} más</button>}
              {list.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Sin citas</p>}
              {onCreate && (
                <button type="button" onClick={() => onCreate(d)} className="mt-1 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-left text-xs font-medium text-primary hover:bg-secondary">
                  <Plus size={12} /> Crear
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Vista mes: cuadricula con conteo y puntos de color; clic = abrir el dia. */
export function MonthView({ date, appointments, onPickDay }: { date: string; appointments: AppointmentDto[]; onPickDay: (d: string) => void }) {
  const { tz } = useAuthed();
  const first = `${date.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDaysStr(start, i));
  const today = todayIn(tz);
  const month = date.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted text-center text-xs font-medium text-muted-foreground">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = appointments.filter((a) => dayOf(a.startsAt, tz) === d && a.status !== 'canceled');
          const staffColors = [...new Set(list.map((a) => a.staffColor))];
          return (
            <button key={d} onClick={() => onPickDay(d)} className={cn('flex min-h-[64px] flex-col items-center gap-1 border-b border-r border-border p-1.5 text-sm hover:bg-secondary md:min-h-[88px]', d.slice(0, 7) !== month && 'bg-muted/40 text-muted-foreground', weekdayOf(d) === 0 && 'bg-muted/30')}>
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', d === today && 'bg-primary text-white')}>{dayNumber(d)}</span>
              {list.length > 0 && <span className="text-[11px] font-semibold text-primary">{list.length} cita{list.length > 1 && 's'}</span>}
              <span className="flex gap-0.5">{staffColors.slice(0, 4).map((c) => <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
