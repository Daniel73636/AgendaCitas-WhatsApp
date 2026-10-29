'use client';
import type { AppointmentDto, StaffDto } from '@agenda/contracts';
import { cn } from '@agenda/ui';
import { DndContext, type DragEndEvent, type DragStartEvent, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type Modifier } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { STATUS_META, fmtTime, hm, isoAt, minutesOfDay } from '@/lib/format';
import { useAuthed } from '@/lib/panel';
import { toast } from '@/lib/session';

export interface WorkBlockLite { staffId: string; weekday: number; start: string; end: string }
export interface TimeOffLite { staffId: string | null; startsAt: string; endsAt: string; isExtraOpening: boolean }

const HOUR_PX = 68;
const PPM = HOUR_PX / 60; // pixeles por minuto
const SNAP = 15;

const snapY: Modifier = ({ transform }) => ({ ...transform, y: Math.round(transform.y / (SNAP * PPM)) * SNAP * PPM });

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function Block({ apt, top, height, left, width, draggable, onOpen }: { apt: AppointmentDto; top: number; height: number; left: string; width: string; draggable: boolean; onOpen: () => void }) {
  const { tz } = useAuthed();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: apt.id, data: { apt }, disabled: !draggable });
  const meta = STATUS_META[apt.status];
  const isHold = apt.status === 'held';
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); if (!isDragging) onOpen(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={`${fmtTime(apt.startsAt, tz)} ${apt.customerName ?? 'Reserva temporal'} ${meta.label}`}
      className={cn(
        'absolute z-10 overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-shadow',
        meta.bg, isHold && 'border-dashed opacity-80', draggable ? 'cursor-grab touch-none active:cursor-grabbing hover:shadow-md' : 'cursor-pointer opacity-90',
        isDragging && 'z-30 cursor-grabbing shadow-xl ring-2 ring-primary',
      )}
      style={{ top, height: Math.max(height, 18), left, width, borderLeftColor: apt.staffColor, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      <p className="flex items-center gap-1 font-semibold text-slate-800">
        {draggable && <GripVertical size={10} className="shrink-0 opacity-40" />}
        <span className="truncate">{fmtTime(apt.startsAt, tz)} {apt.customerName ?? 'Reserva temporal'}</span>
      </p>
      {height > 34 && <p className="truncate text-slate-600">{apt.items.map((i) => i.name).join(' + ')}</p>}
      {height > 54 && apt.status === 'confirmed' && !apt.confirmedByCustomer && <p className="mt-0.5 text-amber-700">⏳ sin confirmar</p>}
    </div>
  );
}

/**
 * CalendarGrid (dia): una columna por profesional, huecos pulsables para crear, colores por estado,
 * arrastrar y soltar (dnd-kit) con actualizacion optimista + PATCH con If-Match y reversion explicada.
 */
export function CalendarGrid({ date, staff, appointments, schedules, timeOff, queryKey, onCreate }: {
  date: string; staff: StaffDto[]; appointments: AppointmentDto[]; schedules: WorkBlockLite[]; timeOff: TimeOffLite[]; queryKey: unknown[]; onCreate: (staffId: string, startsAtIso: string) => void;
}) {
  const { tz, token } = useAuthed();
  const qc = useQueryClient();
  const router = useRouter();
  const colsRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(200);
  const [dragging, setDragging] = useState<AppointmentDto | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);

  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  // Rango visible: segun horarios del dia (con margen), minimo 8-20
  const { startMin, endMin } = useMemo(() => {
    let lo = 8 * 60, hi = 20 * 60;
    for (const b of schedules.filter((s) => s.weekday === weekday)) {
      lo = Math.min(lo, Math.floor(toMin(b.start) / 60) * 60);
      hi = Math.max(hi, Math.ceil(toMin(b.end) / 60) * 60);
    }
    for (const a of appointments) {
      lo = Math.min(lo, Math.floor(minutesOfDay(a.startsAt, tz) / 60) * 60);
      hi = Math.max(hi, Math.min(24 * 60, Math.ceil((minutesOfDay(a.startsAt, tz) + (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000) / 60) * 60));
    }
    return { startMin: lo, endMin: Math.min(hi, 24 * 60) };
  }, [schedules, appointments, weekday, tz]);
  const height = (endMin - startMin) * PPM;

  useEffect(() => {
    const el = colsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setColWidth(el.firstElementChild ? (el.firstElementChild as HTMLElement).getBoundingClientRect().width : 200));
    ro.observe(el);
    return () => ro.disconnect();
  }, [staff.length]);

  useEffect(() => {
    const tick = () => {
      const iso = new Date().toISOString();
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      setNowMin(d === date ? minutesOfDay(iso, tz) : null);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [date, tz]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );

  async function onDragEnd(ev: DragEndEvent) {
    setDragging(null);
    const apt = ev.active.data.current?.apt as AppointmentDto | undefined;
    if (!apt) return;
    const minuteShift = Math.round(ev.delta.y / PPM / SNAP) * SNAP;
    const colShift = Math.round(ev.delta.x / colWidth);
    const idx = staff.findIndex((s) => s.id === apt.staffId);
    const newIdx = Math.max(0, Math.min(staff.length - 1, idx + colShift));
    if (minuteShift === 0 && newIdx === idx) return;
    const newStaff = staff[newIdx]!;
    const delta = minuteShift * 60_000;
    const next: AppointmentDto = {
      ...apt, staffId: newStaff.id, staffName: newStaff.displayName, staffColor: newStaff.color,
      startsAt: new Date(Date.parse(apt.startsAt) + delta).toISOString(), endsAt: new Date(Date.parse(apt.endsAt) + delta).toISOString(),
      occupiedStart: new Date(Date.parse(apt.occupiedStart) + delta).toISOString(), occupiedEnd: new Date(Date.parse(apt.occupiedEnd) + delta).toISOString(),
    };
    // actualizacion optimista
    const key = [...queryKey];
    const snapshot = qc.getQueryData<AppointmentDto[]>(key);
    qc.setQueryData<AppointmentDto[]>(key, (old) => (old ?? []).map((a) => (a.id === apt.id ? next : a)));
    try {
      const saved = await api<AppointmentDto>(`/v1/appointments/${apt.id}`, {
        method: 'PATCH', token, headers: { 'If-Match': String(apt.version) },
        body: { startsAt: next.startsAt, ...(newStaff.id !== apt.staffId ? { staffId: newStaff.id } : {}) },
      });
      qc.setQueryData<AppointmentDto[]>(key, (old) => (old ?? []).map((a) => (a.id === apt.id ? saved : a)));
      toast.success(`Cita movida a las ${fmtTime(saved.startsAt, tz)}${newStaff.id !== apt.staffId ? ` con ${newStaff.displayName.split(' ')[0]}` : ''}`);
      void qc.invalidateQueries({ queryKey: [key[0], 'appointments'] });
    } catch (e) {
      qc.setQueryData(key, snapshot); // revertir
      const err = e as ApiError;
      const why =
        err.code === 'SLOT_TAKEN' ? 'ese horario ya esta ocupado por otra cita'
        : err.code === 'SLOT_UNAVAILABLE' ? err.message.includes('no realiza') ? err.message : 'queda fuera del horario laboral del profesional o en un bloqueo'
        : err.code === 'VERSION_MISMATCH' ? 'otra persona modifico la cita al mismo tiempo; se recargo la agenda'
        : err.message;
      toast.error(`No se pudo mover la cita: ${why}.`);
      void qc.invalidateQueries({ queryKey: [key[0], 'appointments'] });
    }
  }

  // bloques de trabajo por profesional y excepciones (para sombrear fuera de horario)
  const workOf = (staffId: string) => schedules.filter((s) => s.staffId === staffId && s.weekday === weekday).map((s) => [toMin(s.start), toMin(s.end)] as const);
  const offOf = (staffId: string) =>
    timeOff
      .filter((o) => !o.isExtraOpening && (o.staffId === null || o.staffId === staffId))
      .map((o) => [Math.max(startMin, minutesOfDayClamp(o.startsAt, date, tz, 'start')), Math.min(endMin, minutesOfDayClamp(o.endsAt, date, tz, 'end'))] as const)
      .filter(([a, b]) => b > a);

  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin + i * 60);

  return (
    <DndContext sensors={sensors} modifiers={[snapY]} onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.apt as AppointmentDto) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="min-w-[640px]">
          {/* Cabecera de profesionales */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card/95 backdrop-blur">
            <div className="w-14 shrink-0" />
            {staff.map((s) => (
              <div key={s.id} className="flex flex-1 items-center justify-center gap-2 border-l border-border px-2 py-2.5 text-sm font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.displayName.split(' ')[0]}
              </div>
            ))}
          </div>
          <div className="flex">
            {/* Eje de horas */}
            <div className="relative w-14 shrink-0" style={{ height }}>
              {hours.map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: (h - startMin) * PPM }}>{h === startMin ? '' : hm(h)}</span>
              ))}
            </div>
            <div ref={colsRef} className="relative flex flex-1">
              {staff.map((s) => {
                const dayApts = appointments.filter((a) => a.staffId === s.id && a.status !== 'canceled');
                const work = workOf(s.id);
                return (
                  <div
                    key={s.id}
                    className="relative flex-1 cursor-pointer border-l border-border bg-muted/70"
                    style={{ height }}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const mins = startMin + Math.floor((e.clientY - rect.top) / PPM / SNAP) * SNAP;
                      onCreate(s.id, isoAt(date, mins, tz));
                    }}
                    title="Clic en un hueco libre para crear una cita"
                  >
                    {/* horario laboral (blanco) */}
                    {work.map(([a, b], i) => (
                      <div key={i} className="absolute inset-x-0 bg-card" style={{ top: (Math.max(a, startMin) - startMin) * PPM, height: (Math.min(b, endMin) - Math.max(a, startMin)) * PPM, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SNAP * PPM - 1}px, hsl(var(--border) / .6) ${SNAP * PPM - 1}px, hsl(var(--border) / .6) ${SNAP * PPM}px)` }} />
                    ))}
                    {work.length === 0 && <span className="absolute inset-x-0 top-3 text-center text-[11px] text-muted-foreground">No trabaja</span>}
                    {/* horas completas */}
                    {hours.map((h) => <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: (h - startMin) * PPM }} />)}
                    {/* bloqueos / permisos */}
                    {offOf(s.id).map(([a, b], i) => (
                      <div key={i} className="pointer-events-none absolute inset-x-0 z-[5] bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(100,100,120,.18)_6px,rgba(100,100,120,.18)_12px)]" style={{ top: (a - startMin) * PPM, height: (b - a) * PPM }} title="Bloqueado" />
                    ))}
                    {dayApts.map((a) => {
                      const sMin = minutesOfDay(a.startsAt, tz);
                      const dur = (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000;
                      return (
                        <Block key={a.id} apt={a} top={(sMin - startMin) * PPM} height={dur * PPM - 2} left="3px" width="calc(100% - 6px)" draggable={['pending', 'confirmed'].includes(a.status)} onOpen={() => router.push(`/citas/${a.id}`)} />
                      );
                    })}
                  </div>
                );
              })}
              {nowMin !== null && nowMin >= startMin && nowMin <= endMin && (
                <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - startMin) * PPM }}>
                  <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                  <span className="h-px flex-1 bg-red-500" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Tip: arrastra una cita para moverla (o cambiarla de profesional); en pantallas tactiles manten presionado. Clic en un hueco libre para crear una cita.</p>
      {dragging && null}
    </DndContext>
  );
}

/** Minutos del dia (zona del negocio) de un instante, recortados al dia `date`. */
function minutesOfDayClamp(iso: string, date: string, tz: string, edge: 'start' | 'end'): number {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  if (d < date) return 0;
  if (d > date) return 24 * 60;
  const m = minutesOfDay(iso, tz);
  return edge === 'end' && m === 0 ? 24 * 60 : m;
}
