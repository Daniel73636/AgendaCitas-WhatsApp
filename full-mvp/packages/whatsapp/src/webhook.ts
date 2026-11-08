export type InboundEvent =
  | { type: 'text'; from: string; text: string; waMessageId: string }
  | { type: 'button'; from: string; payload: string; text: string; waMessageId: string }
  | { type: 'status'; waMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; errorCode?: string };

/** Parsea el cuerpo del webhook de la WhatsApp Cloud API a eventos simples. */
export function parseWebhook(payload: unknown): InboundEvent[] {
  const out: InboundEvent[] = [];
  const p = payload as { entry?: Array<{ changes?: Array<{ value?: any }> }> };
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const m of v.messages ?? []) {
        const from = String(m.from ?? '');
        const phone = from.startsWith('+') ? from : `+${from}`;
        if (m.type === 'button' && m.button?.payload) {
          out.push({ type: 'button', from: phone, payload: String(m.button.payload), text: String(m.button.text ?? ''), waMessageId: String(m.id) });
        } else if (m.type === 'interactive' && m.interactive?.button_reply?.id) {
          out.push({ type: 'button', from: phone, payload: String(m.interactive.button_reply.id), text: String(m.interactive.button_reply.title ?? ''), waMessageId: String(m.id) });
        } else if (m.type === 'text') {
          out.push({ type: 'text', from: phone, text: String(m.text?.body ?? ''), waMessageId: String(m.id) });
        }
      }
      for (const s of v.statuses ?? []) {
        out.push({
          type: 'status',
          waMessageId: String(s.id),
          status: s.status,
          ...(s.errors?.[0]?.code ? { errorCode: String(s.errors[0].code) } : {}),
        });
      }
    }
  }
  return out;
}
