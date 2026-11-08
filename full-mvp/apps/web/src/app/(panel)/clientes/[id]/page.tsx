'use client';
import type { AppointmentDto, CustomerDto, MessageDto } from '@agenda/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Modal, Skeleton, Stat } from '@agenda/ui';
import { ArrowLeft, Cake, GitMerge, Mail, MessageCircle, Pencil, Phone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { StatusBadge } from '@/components/panel/apt-actions';
import { NewAppointmentDialog } from '@/components/panel/new-appointment-dialog';
import { api } from '@/lib/api';
import { fmtDateTime, money, waLink } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';
import { CustomerForm } from '@/components/panel/customer-form';

interface Timeline { customer: CustomerDto; appointments: AppointmentDto[]; messages: MessageDto[] }

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tz, currency } = useAuthed();
  const q = usePQuery<Timeline>(['customers', 'timeline', id], `/v1/customers/${id}/timeline`, { staleTime: 5_000 });
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [booking, setBooking] = useState(false);

  if (q.isLoading) return <div className="mx-auto max-w-4xl space-y-3"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>;
  if (!q.data) return <EmptyState title="Cliente no encontrado" action={<Link href="/clientes" className="text-primary">Volver</Link>} />;
  const { customer: c, appointments, messages } = q.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link href="/clientes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Clientes</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{c.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Phone size={14} /> {c.phone}</span>
            {c.email && <span className="flex items-center gap-1"><Mail size={14} /> {c.email}</span>}
            {c.birthday && <span className="flex items-center gap-1"><Cake size={14} /> {c.birthday}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.noShowCount >= 2 && <Badge tone="danger">Riesgo: {c.noShowCount} inasistencias</Badge>}
            {c.tags.map((t) => <Badge key={t} tone="primary">{t}</Badge>)}
            {c.consentWhatsapp ? <Badge tone="success">WhatsApp OK</Badge> : <Badge>Sin consentimiento WhatsApp</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setBooking(true)}>+ Nueva cita</Button>
          <a href={waLink(c.phone)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted"><MessageCircle size={16} /> WhatsApp</a>
          <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={16} /> Editar</Button>
          <Button variant="outline" onClick={() => setMerging(true)}><GitMerge size={16} /> Unificar</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visitas" value={c.visits} />
        <Stat label="Total gastado" value={money(c.totalSpentCents, currency)} />
        <Stat label="Inasistencias" value={c.noShowCount} tone={c.noShowCount >= 2 ? 'danger' : 'default'} />
        <Stat label="Cancelaciones" value={c.lateCancelCount} />
      </div>

      {c.notes && <Card className="p-4 text-sm"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notas</p><p className="whitespace-pre-wrap">{c.notes}</p></Card>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Linea de tiempo de citas</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {appointments.length === 0 && <p className="text-sm text-muted-foreground">Sin citas todavia.</p>}
            {appointments.map((a) => (
              <Link key={a.id} href={`/citas/${a.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm hover:bg-muted">
                <span><span className="block font-medium">{a.items.map((i) => i.name).join(' + ')}</span><span className="text-xs text-muted-foreground">{fmtDateTime(a.startsAt, tz)} · {a.staffName.split(' ')[0]}</span></span>
                <span className="flex flex-col items-end gap-1"><StatusBadge status={a.status} /><span className="text-xs tabular-nums">{money(a.totalCents, currency)}</span></span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Mensajes de WhatsApp</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {messages.length === 0 && <p className="text-sm text-muted-foreground">Sin mensajes.</p>}
            {messages.slice(0, 12).map((m) => (
              <div key={m.id} className={`rounded-xl p-2.5 text-sm ${m.direction === 'in' ? 'bg-muted' : 'bg-secondary'}`}>
                <p className="mb-0.5 text-[11px] text-muted-foreground">{m.direction === 'in' ? 'Cliente' : 'Negocio'} · {fmtDateTime(m.createdAt, tz)} {m.template && `· ${m.template}`}</p>
                <p className="line-clamp-3">{m.body}</p>
              </div>
            ))}
            <Link href={`/mensajes?phone=${encodeURIComponent(c.phone)}`} className="text-sm font-medium text-primary">Abrir conversacion →</Link>
          </CardContent>
        </Card>
      </div>

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
      {merging && <MergeDialog customer={c} onClose={() => setMerging(false)} />}
      {booking && <NewAppointmentDialog open onClose={() => setBooking(false)} initial={{ customerId: c.id }} />}
    </div>
  );
}

/** Unificacion de ffichas (cliente que cambia de numero), con confirmacion explicita. */
function MergeDialog({ customer, onClose }: { customer: CustomerDto; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const list = usePQuery<CustomerDto[]>(['customers', 'merge', q], q.length >= 2 ? `/v1/customers?q=${encodeURIComponent(q)}` : null);
  const [target, setTarget] = useState<CustomerDto | null>(null);
  const merge = useApiMutation((_: void, { token }) => api<CustomerDto>(`/v1/customers/${customer.id}/merge`, { method: 'POST', token, body: { intoCustomerId: target!.id } }), {
    invalidate: [['customers']], success: 'Fichas unificadas', onSuccess: (c) => { onClose(); router.replace(`/clientes/${c.id}`); },
  });
  return (
    <Modal open onClose={onClose} title="Unificar fichas" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="destructive" disabled={!target} loading={merge.isPending} onClick={() => merge.mutate()}>Unificar</Button></>}>
      <p className="mb-3 text-sm text-muted-foreground">Mueve las citas, mensajes y contadores de <b>{customer.fullName}</b> ({customer.phone}) a la ficha que elijas. Esta accion no se puede deshacer.</p>
      <input className="mb-2 h-10 w-full rounded-xl border border-border px-3 text-sm" placeholder="Buscar la ficha de destino..." value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {(list.data ?? []).filter((x) => x.id !== customer.id).map((x) => (
          <li key={x.id}><button onClick={() => setTarget(x)} className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${target?.id === x.id ? 'bg-primary/10 font-medium' : ''}`}>{x.fullName} <span className="text-xs text-muted-foreground">{x.phone}</span></button></li>
        ))}
      </ul>
      {target && <p className="mt-3 rounded-xl bg-warning/20 p-3 text-sm text-warning-foreground">Se conservara la ficha de <b>{target.fullName}</b> y se eliminara la de {customer.fullName}.</p>}
    </Modal>
  );
}
