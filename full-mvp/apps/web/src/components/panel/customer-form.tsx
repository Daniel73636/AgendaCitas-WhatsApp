'use client';
import type { CustomerDto } from '@agenda/contracts';
import { Button, Field, Input, Modal, Switch, Textarea } from '@agenda/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/panel';

export function CustomerForm({ onClose, customer }: { onClose: () => void; customer?: CustomerDto }) {
  const router = useRouter();
  const [f, setF] = useState({
    fullName: customer?.fullName ?? '', phone: customer?.phone ?? '+57', email: customer?.email ?? '', birthday: customer?.birthday ?? '',
    notes: customer?.notes ?? '', tags: (customer?.tags ?? []).join(', '), consentWhatsapp: customer?.consentWhatsapp ?? true,
  });
  const body = () => ({
    fullName: f.fullName.trim(), phone: f.phone.replace(/[\s\-().]/g, ''), email: f.email || null, birthday: f.birthday || null,
    notes: f.notes || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), consentWhatsapp: f.consentWhatsapp,
  });
  const save = useApiMutation(
    (_: void, { token }) => (customer ? api<CustomerDto>(`/v1/customers/${customer.id}`, { method: 'PATCH', token, body: body() }) : api<CustomerDto>('/v1/customers', { method: 'POST', token, body: body() })),
    { invalidate: [['customers']], success: customer ? 'Cliente actualizado' : 'Cliente creado', onSuccess: (c) => { onClose(); if (!customer) router.push(`/clientes/${c.id}`); } },
  );
  return (
    <Modal open onClose={onClose} title={customer ? 'Editar cliente' : 'Nuevo cliente'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={f.fullName.trim().length < 2} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre completo" className="sm:col-span-2"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Celular (E.164)" hint="Ej: +573001234567"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Correo"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Cumpleanos"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
        <Field label="Etiquetas" hint="Separadas por coma: vip, riesgo"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        <Field label="Notas (cifradas en la base de datos)" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.consentWhatsapp} onChange={(v) => setF({ ...f, consentWhatsapp: v })} label="Acepta mensajes por WhatsApp" /></div>
      </div>
    </Modal>
  );
}
