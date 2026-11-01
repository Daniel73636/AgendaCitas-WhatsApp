'use client';
import type { StaffDto, TimeOffDto } from '@agenda/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Modal, Select, Skeleton, Switch, cn } from '@agenda/ui';
import { CalendarOff, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { dayOf, fmtDateTime, isoAt, todayIn, weekdayLong } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

interface Block { weekday: number; start: string; end: string }
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function SchedulesPage() {
  const { tz, role } = useAuthed();
  const owner = role === 'owner';
  const staff = usePQuery<StaffDto[]>(['staff'], '/v1/staff', { staleTime: 30_000 });
  const [staffId, setStaffId] = useState('');
  useEffect(() => { if (!staffId && staff.data?.[0]) setStaffId(staff.data[0].id); }, [staff.data, staffId]);
  const sched = usePQuery<Array<Block & { id: string; staffId: string }>>(['schedules', staffId], staffId ? `/v1/schedules?staffId=${staffId}` : null, { staleTime: 10_000 });
  const off = usePQuery<TimeOffDto[]>(['time-off', 'all'], `/v1/time-off?from=${encodeURIComponent(new Date().toISOString())}`, { staleTime: 10_000 });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (sched.data && !dirty) setBlocks(sched.data.map(({ weekday, start, end }) => ({ weekday, start, end }))); }, [sched.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setDirty(false), [staffId]);

  const save = useApiMutation((_: void, { token }) => api(`/v1/schedules/${staffId}`, { method: 'PUT', token, body: { blocks } }), { invalidate: [['schedules'], ['appointments']], success: 'Horario guardado', onSuccess: () => setDirty(false) });
  const delOff = useApiMutation((id: string, { token }) => api(`/v1/time-off/${id}`, { method: 'DELETE', token }), { invalidate: [['time-off']], success: 'Excepcion eliminada' });

  const edit = (next: Block[]) => { setBlocks(next); setDirty(true); };
  const dayBlocks = (d: number) => blocks.map((b, i) => ({ b, i })).filter((x) => x.b.weekday === d);
  const invalid = blocks.some((b) => b.end <= b.start);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Horarios</h1><p className="text-sm text-muted-foreground">Bloques semanales (puedes tener varios por dia, p. ej. con pausa de almuerzo).</p></div>
        <Select aria-label="Profesional" className="w-52" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Horario semanal</CardTitle>
          {owner && <Button size="sm" disabled={!dirty || invalid} loading={save.isPending} onClick={() => save.mutate()}><Save size={14} /> Guardar cambios</Button>}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {sched.isLoading && <Skeleton className="h-64" />}
          {ORDER.map((d) => {
            const list = dayBlocks(d);
            return (
              <div key={d} className={cn('flex flex-wrap items-center gap-3 rounded-xl border p-3', list.length ? 'border-border' : 'border-dashed border-border bg-muted/40')}>
                <span className="w-24 text-sm font-semibold">{weekdayLong(d)}</span>
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {list.length === 0 && <span className="text-sm text-muted-foreground">No trabaja</span>}
                  {list.map(({ b, i }) => (
                    <div key={i} className={cn('flex items-center gap-1 rounded-lg bg-secondary px-2 py-1', b.end <= b.start && 'ring-2 ring-destructive')}>
                      <input aria-label="Desde" type="time" step={900} disabled={!owner} value={b.start} onChange={(e) => edit(blocks.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} className="w-[5.2rem] rounded bg-transparent text-sm" />
                      <span className="text-muted-foreground">–</span>
                      <input aria-label="Hasta" type="time" step={900} disabled={!owner} value={b.end} onChange={(e) => edit(blocks.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} className="w-[5.2rem] rounded bg-transparent text-sm" />
                      {owner && <button aria-label="Quitar bloque" onClick={() => edit(blocks.filter((_, k) => k !== i))} className="ml-1 text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>}
                    </div>
                  ))}
                </div>
                {owner && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => edit([...blocks, { weekday: d, start: list.length ? list[list.length - 1]!.b.end : '09:00', end: list.length ? '18:00' : '13:00' }])}><Plus size={14} /> Bloque</Button>
                    {list.length > 0 && <Button size="sm" variant="ghost" title="Copiar a Lun-Sab" onClick={() => edit([...blocks.filter((b) => b.weekday === 0 || b.weekday === d), ...[1, 2, 3, 4, 5, 6].filter((x) => x !== d).flatMap((x) => list.map(({ b }) => ({ ...b, weekday: x })))])}><Copy size={14} /></Button>}
                  </div>
                )}
              </div>
            );
          })}
          {invalid && <p className="text-sm text-destructive">Hay bloques donde la hora final no es mayor que la inicial.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Excepciones: vacaciones, permisos, festivos, aperturas especiales</CardTitle>{owner && <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Agregar</Button>}</CardHeader>
        <CardContent className="flex flex-col gap-2">
          {off.data?.length === 0 && <p className="text-sm text-muted-foreground">No hay excepciones proximas.</p>}
          {off.data?.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
              <div className="flex items-start gap-3">
                <CalendarOff size={18} className={o.isExtraOpening ? 'text-success' : 'text-muted-foreground'} />
                <div>
                  <p className="font-medium">{o.reason ?? (o.isExtraOpening ? 'Apertura especial' : 'Bloqueo')} <Badge tone={o.isExtraOpening ? 'success' : 'neutral'}>{o.isExtraOpening ? 'Suma disponibilidad' : 'Resta disponibilidad'}</Badge></p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(o.startsAt, tz)} → {fmtDateTime(o.endsAt, tz)} · {o.staffId ? staff.data?.find((s) => s.id === o.staffId)?.displayName : 'Toda la sede'}</p>
                </div>
              </div>
              {owner && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delOff.mutate(o.id)}><Trash2 size={14} /></Button>}
            </div>
          ))}
        </CardContent>
      </Card>
      {adding && <TimeOffForm staff={staff.data ?? []} defaultStaff={staffId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function TimeOffForm({ staff, defaultStaff, onClose }: { staff: StaffDto[]; defaultStaff: string; onClose: () => void }) {
  const { tz } = useAuthed();
  const today = todayIn(tz);
  const [f, setF] = useState({ staffId: defaultStaff, fromDate: today, toDate: today, allDay: true, fromTime: '09:00', toTime: '13:00', reason: '', extra: false });
  const save = useApiMutation(
    (_: void, { token }) => {
      const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const startsAt = isoAt(f.fromDate, f.allDay ? 0 : mins(f.fromTime), tz);
      const endsAt = f.allDay ? isoAt(addOne(f.toDate), 0, tz) : isoAt(f.toDate, mins(f.toTime), tz);
      return api('/v1/time-off', { method: 'POST', token, body: { staffId: f.staffId || null, startsAt, endsAt, reason: f.reason || null, isExtraOpening: f.extra } });
    },
    { invalidate: [['time-off'], ['appointments']], success: 'Excepcion guardada', onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Nueva excepcion" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Aplica a"><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}><option value="">Toda la sede (festivo)</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde"><Input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></Field>
          <Field label="Hasta"><Input type="date" value={f.toDate} min={f.fromDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
        </div>
        <Switch checked={f.allDay} onChange={(v) => setF({ ...f, allDay: v })} label="Todo el dia" />
        {!f.allDay && <div className="grid grid-cols-2 gap-3"><Field label="Hora inicio"><Input type="time" value={f.fromTime} onChange={(e) => setF({ ...f, fromTime: e.target.value })} /></Field><Field label="Hora fin"><Input type="time" value={f.toTime} onChange={(e) => setF({ ...f, toTime: e.target.value })} /></Field></div>}
        <Field label="Motivo"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Vacaciones, cita medica, festivo..." /></Field>
        <Switch checked={f.extra} onChange={(v) => setF({ ...f, extra: v })} label="Es una apertura especial (suma disponibilidad)" />
      </div>
    </Modal>
  );
}
const addOne = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
