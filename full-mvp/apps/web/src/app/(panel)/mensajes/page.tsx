'use client';
import type { ConversationDto, MessageDto } from '@agenda/contracts';
import { Badge, Button, EmptyState, Input, Skeleton, cn } from '@agenda/ui';
import { ArrowLeft, Check, CheckCheck, MessageSquare, Send, Zap } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtTime, initials } from '@/lib/format';
import { useApiMutation, useAuthed, usePQuery } from '@/lib/panel';

const QUICK = [
  'Hola, con gusto te ayudamos. ¿Que dia y hora prefieres?',
  'Tu cita quedo confirmada. ¡Te esperamos!',
  'Gracias por avisarnos. Ya reprogramamos tu cita.',
  'Estamos ubicados en la sede principal. Te comparto la ubicacion por aqui.',
];

function Inbox() {
  const { tz } = useAuthed();
  const params = useSearchParams();
  const [phone, setPhone] = useState<string | null>(params.get('phone'));
  const convs = usePQuery<ConversationDto[]>(['conversations'], '/v1/messages', { staleTime: 5_000 });
  const thread = usePQuery<MessageDto[]>(['thread', phone], phone ? `/v1/messages/thread?phone=${encodeURIComponent(phone)}` : null, { staleTime: 2_000 });
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const current = convs.data?.find((c) => c.phone === phone);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread.data?.length, phone]);
  useEffect(() => { if (!phone && convs.data?.[0] && window.matchMedia('(min-width: 768px)').matches) setPhone(convs.data[0].phone); }, [convs.data, phone]);

  const send = useApiMutation((body: string, { token }) => api('/v1/messages/reply', { method: 'POST', token, body: { phone, body } }), { invalidate: [['thread'], ['conversations']], onSuccess: () => setText('') });
  const simulate = useApiMutation((body: string, { token }) => api('/v1/messages/simulate-inbound', { method: 'POST', token, body: { phone, body } }), { invalidate: [['thread'], ['conversations']], success: 'Mensaje entrante simulado' });

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-5xl flex-col gap-3 md:h-[calc(100dvh-5rem)]">
      <h1 className="text-2xl font-bold">Mensajes</h1>
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[20rem_1fr]">
        {/* Lista de conversaciones */}
        <div className={cn('flex min-h-0 flex-col overflow-y-auto border-r border-border', phone && 'hidden md:flex')}>
          {convs.isLoading && <div className="space-y-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
          {convs.data?.length === 0 && <EmptyState icon={<MessageSquare />} title="Sin conversaciones" description="Aqui veras los mensajes de WhatsApp de tus clientes." />}
          {convs.data?.map((c) => (
            <button key={c.phone} onClick={() => setPhone(c.phone)} className={cn('flex items-center gap-3 border-b border-border px-3 py-3 text-left hover:bg-muted', phone === c.phone && 'bg-secondary')}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(c.customerName ?? c.phone.slice(-4))}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.customerName ?? c.phone}</span><span className="shrink-0 text-[11px] text-muted-foreground">{fmtTime(c.lastAt, tz)}</span></span>
                <span className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted-foreground">{c.lastMessage}</span>{c.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Panel de chat */}
        <div className={cn('flex min-h-0 flex-col', !phone && 'hidden md:flex')}>
          {!phone ? (
            <div className="m-auto text-center text-muted-foreground"><MessageSquare className="mx-auto mb-2" /> Elige una conversacion</div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
                <button className="md:hidden" aria-label="Volver" onClick={() => setPhone(null)}><ArrowLeft size={20} /></button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{current?.customerName ?? phone}</p>
                  <p className="text-xs text-muted-foreground">{phone}</p>
                </div>
                {current?.customerId && <Link href={`/clientes/${current.customerId}`} className="text-xs font-medium text-primary">Ver ficha</Link>}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-muted/40 p-3">
                {thread.data?.map((m) => (
                  <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm', m.direction === 'out' ? 'rounded-br-md bg-emerald-100' : 'rounded-bl-md bg-card')}>
                      {m.template && <Badge tone="primary" className="mb-1">{m.template}</Badge>}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                        {fmtDateTime(m.createdAt, tz)}
                        {m.direction === 'out' && (m.status === 'failed' ? <span className="text-destructive">falló</span> : m.status === 'delivered' || m.status === 'read' ? <CheckCheck size={12} className="text-sky-500" /> : <Check size={12} />)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="border-t border-border p-2">
                <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
                  {QUICK.map((q) => <button key={q} onClick={() => setText(q)} className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:bg-secondary"><Zap size={11} className="text-primary" />{q.slice(0, 34)}…</button>)}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text.trim()); }}>
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe una respuesta..." aria-label="Mensaje" />
                  <Button type="submit" size="icon" loading={send.isPending} aria-label="Enviar"><Send size={16} /></Button>
                </form>
                <button className="mt-2 text-[11px] text-muted-foreground underline" onClick={() => simulate.mutate(text.trim() || 'Hola, ¿tienen disponibilidad esta semana?')}>Demo (mock): simular mensaje entrante del cliente</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Inbox />
    </Suspense>
  );
}
