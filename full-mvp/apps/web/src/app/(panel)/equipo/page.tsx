'use client';
import type { ServiceDto, StaffDto } from '@agenda/contracts';
import { Badge, Button, Card, Field, Input, Modal, Skeleton, Switch, Textarea, cn } from '@agenda/ui';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/booking/booking-wizard';
import { ApiError, api } from '@/lib/api';
import { fromCents, money, toCents } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

export default function TeamPage() {
  const { role } = useAuthed();
  const staff = usePQuery<StaffDto[]>(['staff'], '/v1/staff', { staleTime: 30_000 });
  const services = usePQuery<ServiceDto[]>(['services'], '/v1/services', { staleTime: 30_000 });
  const [editing, setEditing] = useState<StaffDto | 'new' | null>(null);
  const owner = role === 'owner';
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Equipo</h1><p className="text-sm text-muted-foreground">Profesionales, servicios que realizan y comisiones.</p></div>
        {owner && <Button onClick={() => setEditing('new')}><Plus size={16} /> Nuevo profesional</Button>}
      </div>
      {staff.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      <div className="grid gap-3 md:grid-cols-2">
        {staff.data?.map((s) => (
          <Card key={s.id} className={cn('p-4', !s.active && 'opacity-60')}>
            <div className="flex gap-3">
              <Avatar name={s.displayName} color={s.color} photoUrl={s.photoUrl} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className="font-semibold">{s.displayName}</p>{!s.active && <Badge>Inactivo</Badge>}</div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{s.bio}</p>
                <div className="mt-2 flex flex-wrap gap-1">{s.specialties.map((sp) => <Badge key={sp} tone="primary">{sp}</Badge>)}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Servicios: {s.serviceIds.map((id) => services.data?.find((x) => x.id === id)?.name).filter(Boolean).join(', ')} · Comision {s.commissionPct}%</p>
            {owner && <Button className="mt-3" size="sm" variant="outline" onClick={() => setEditing(s)}><Pencil size={14} /> Editar</Button>}
          </Card>
        ))}
      </div>
      {editing && <StaffForm member={editing === 'new' ? undefined : editing} services={services.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StaffForm({ member, services, onClose }: { member?: StaffDto | undefined; services: ServiceDto[]; onClose: () => void }) {
  const { currency } = useAuthed();
  const [f, setF] = useState({
    displayName: member?.displayName ?? '', bio: member?.bio ?? '', specialties: (member?.specialties ?? []).join(', '), color: member?.color ?? '#7c3aed',
    priority: String(member?.priority ?? 0), commission: String(member?.commissionPct ?? 0), active: member?.active ?? true,
    services: Object.fromEntries((member?.serviceOverrides ?? []).map((o) => [o.serviceId, { price: o.priceCentsOverride != null ? fromCents(o.priceCentsOverride) : '', dur: o.durationMinOverride != null ? String(o.durationMinOverride) : '' }])) as Record<string, { price: string; dur: string }>,
  });
  const [conflict, setConflict] = useState<{ count: number; proposal: Array<{ appointmentId: string; newStaffId: string | null }> } | null>(null);
  const body = (reassign = false) => ({
    displayName: f.displayName.trim(), bio: f.bio || null, specialties: f.specialties.split(',').map((x) => x.trim()).filter(Boolean), color: f.color,
    priority: Number(f.priority) || 0, commissionPct: Number(f.commission) || 0, active: f.active, reassign,
    services: Object.entries(f.services).map(([serviceId, v]) => ({ serviceId, priceCentsOverride: v.price ? toCents(v.price) : null, durationMinOverride: v.dur ? Number(v.dur) : null })),
  });
  const save = useApiMutation(
    (reassign: boolean, { token }) => (member ? api(`/v1/staff/${member.id}`, { method: 'PATCH', token, body: body(reassign) }) : api('/v1/staff', { method: 'POST', token, body: body() })),
    {
      invalidate: [['staff'], ['services'], ['appointments']], success: 'Profesional guardado', onSuccess: onClose, silentError: true,
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'HAS_FUTURE_APPOINTMENTS') setConflict(e.details as never);
        else import('@/lib/session').then(({ toast }) => toast.error(e.message));
      },
    },
  );
  return (
    <Modal open onClose={onClose} title={member ? 'Editar profesional' : 'Nuevo profesional'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={f.displayName.trim().length < 2} loading={save.isPending} onClick={() => save.mutate(false)}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre visible" className="sm:col-span-2"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Presentacion" className="sm:col-span-2"><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Especialidades" hint="Separadas por coma"><Input value={f.specialties} onChange={(e) => setF({ ...f, specialties: e.target.value })} /></Field>
        <Field label="Color en el calendario"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-full cursor-pointer rounded-xl border border-border" aria-label="Color" /></Field>
        <Field label="Preferencia al asignar 'Cualquiera'" hint="Mayor numero = se asigna primero"><Input inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Comision (%)"><Input inputMode="decimal" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Activo (aparece para reservas)" /></div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Servicios que realiza (precio y duracion propios opcionales)</p>
          <div className="flex flex-col gap-2">
            {services.filter((s) => s.active).map((s) => {
              const on = !!f.services[s.id];
              return (
                <div key={s.id} className={cn('flex flex-wrap items-center gap-2 rounded-xl border p-2.5', on ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={on} className="accent-[hsl(var(--primary))]" onChange={(e) => { const next = { ...f.services }; if (e.target.checked) next[s.id] = { price: '', dur: '' }; else delete next[s.id]; setF({ ...f, services: next }); }} />{s.name}<span className="text-xs text-muted-foreground">({money(s.priceCents, currency)} · {s.durationMin} min)</span></label>
                  {on && (
                    <>
                      <Input className="h-8 w-28" inputMode="numeric" placeholder="Precio propio" value={f.services[s.id]!.price} onChange={(e) => setF({ ...f, services: { ...f.services, [s.id]: { ...f.services[s.id]!, price: e.target.value } } })} />
                      <Input className="h-8 w-24" inputMode="numeric" placeholder="Min propios" value={f.services[s.id]!.dur} onChange={(e) => setF({ ...f, services: { ...f.services, [s.id]: { ...f.services[s.id]!, dur: e.target.value.replace(/\D/g, '') } } })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {conflict && (
        <div className="mt-4 rounded-xl border border-warning/60 bg-warning/15 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> {conflict.count} cita(s) futura(s) con este profesional</p>
          <p className="mt-1 text-muted-foreground">{conflict.proposal.filter((p) => p.newStaffId).length} se pueden reasignar automaticamente a otro profesional libre en el mismo horario; {conflict.proposal.filter((p) => !p.newStaffId).length} no tienen reemplazo (muevelas desde el calendario).</p>
          <Button className="mt-2" size="sm" disabled={conflict.proposal.some((p) => !p.newStaffId)} loading={save.isPending} onClick={() => save.mutate(true)}>Reasignar y desactivar</Button>
        </div>
      )}
    </Modal>
  );
}
