'use client';
import type { ServiceDto, StaffDto } from '@agenda/contracts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Skeleton, Switch, Textarea, cn } from '@agenda/ui';
import { Clock, Eye, EyeOff, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { durationLabel, fromCents, money, toCents } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

export default function ServicesPage() {
  const { currency, role } = useAuthed();
  const q = usePQuery<ServiceDto[]>(['services'], '/v1/services', { staleTime: 30_000 });
  const staff = usePQuery<StaffDto[]>(['staff'], '/v1/staff', { staleTime: 30_000 });
  const [editing, setEditing] = useState<ServiceDto | 'new' | null>(null);
  const owner = role === 'owner';
  const del = useApiMutation((id: string, { token }) => api(`/v1/services/${id}`, { method: 'DELETE', token }), { invalidate: [['services'], ['staff']], success: 'Servicio eliminado (las citas existentes conservan su historial)' });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Servicios</h1><p className="text-sm text-muted-foreground">Cambiar la duracion de un servicio no altera las citas ya agendadas.</p></div>
        {owner && <Button onClick={() => setEditing('new')}><Plus size={16} /> Nuevo servicio</Button>}
      </div>
      {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      {q.data?.length === 0 && <EmptyState icon={<Scissors size={32} />} title="Aun no tienes servicios" description="Crea tu primer servicio para empezar a recibir reservas." action={owner ? <Button onClick={() => setEditing('new')}>Crear servicio</Button> : undefined} />}
      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.map((s) => (
          <Card key={s.id} className={cn('p-4', !s.active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{s.name}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
              </div>
              <p className="shrink-0 font-bold tabular-nums">{money(s.priceCents, currency)}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge><Clock size={11} /> {durationLabel(s.durationMin)}</Badge>
              {(s.bufferBeforeMin > 0 || s.bufferAfterMin > 0) && <Badge>Colchon {s.bufferBeforeMin}+{s.bufferAfterMin} min</Badge>}
              {s.depositCents > 0 && <Badge tone="warning">Anticipo {money(s.depositCents, currency)}</Badge>}
              {s.category && <Badge tone="primary">{s.category}</Badge>}
              {s.visiblePublic ? <Badge tone="success"><Eye size={11} /> Publico</Badge> : <Badge><EyeOff size={11} /> Oculto</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Lo realizan: {s.staffIds.map((id) => staff.data?.find((x) => x.id === id)?.displayName.split(' ')[0]).filter(Boolean).join(', ') || 'nadie (asigna un profesional)'}</p>
            {owner && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(s)}><Pencil size={14} /> Editar</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm(`¿Eliminar "${s.name}"?`) && del.mutate(s.id)}><Trash2 size={14} /></Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {editing && <ServiceForm service={editing === 'new' ? undefined : editing} staff={staff.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceForm({ service, staff, onClose }: { service?: ServiceDto | undefined; staff: StaffDto[]; onClose: () => void }) {
  const [f, setF] = useState({
    name: service?.name ?? '', description: service?.description ?? '', category: service?.category ?? '', durationMin: String(service?.durationMin ?? 45),
    before: String(service?.bufferBeforeMin ?? 0), after: String(service?.bufferAfterMin ?? 0), price: fromCents(service?.priceCents ?? 0), deposit: fromCents(service?.depositCents ?? 0),
    visiblePublic: service?.visiblePublic ?? true, active: service?.active ?? true, staffIds: service?.staffIds ?? staff.map((s) => s.id),
  });
  const body = () => ({
    name: f.name.trim(), description: f.description || null, category: f.category || null, durationMin: Number(f.durationMin), bufferBeforeMin: Number(f.before) || 0, bufferAfterMin: Number(f.after) || 0,
    priceCents: toCents(f.price), depositCents: toCents(f.deposit), visiblePublic: f.visiblePublic, active: f.active, staffIds: f.staffIds,
  });
  const save = useApiMutation(
    (_: void, { token }) => (service ? api(`/v1/services/${service.id}`, { method: 'PATCH', token, body: body() }) : api('/v1/services', { method: 'POST', token, body: body() })),
    { invalidate: [['services'], ['staff']], success: service ? 'Servicio actualizado' : 'Servicio creado', onSuccess: onClose },
  );
  const valid = f.name.trim().length >= 2 && Number(f.durationMin) >= 5;
  return (
    <Modal open onClose={onClose} title={service ? 'Editar servicio' : 'Nuevo servicio'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Descripcion" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Categoria"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Cabello, Unas..." /></Field>
        <Field label="Duracion (min)"><Input inputMode="numeric" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Preparacion antes (min)"><Input inputMode="numeric" value={f.before} onChange={(e) => setF({ ...f, before: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Limpieza despues (min)"><Input inputMode="numeric" value={f.after} onChange={(e) => setF({ ...f, after: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Precio" hint="En pesos; se guarda en centavos enteros."><Input inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Anticipo (opcional)"><Input inputMode="numeric" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Switch checked={f.visiblePublic} onChange={(v) => setF({ ...f, visiblePublic: v })} label="Visible en la pagina publica de reservas" />
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Activo" />
        </div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Profesionales que lo realizan</p>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => {
              const on = f.staffIds.includes(s.id);
              return <button key={s.id} type="button" onClick={() => setF({ ...f, staffIds: on ? f.staffIds.filter((x) => x !== s.id) : [...f.staffIds, s.id] })} className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary/10' : 'border-border')}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.displayName}</button>;
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
