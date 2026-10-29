import { Injectable } from '@nestjs/common';
import type { RealtimeEvent, RealtimeEventType } from '@agenda/contracts';
import { Observable, Subject } from 'rxjs';

const BUFFER = 300;

/** Bus de eventos en memoria por tenant (SSE) con buffer para reconexion via Last-Event-ID. */
@Injectable()
export class EventsService {
  private seq = 0;
  private readonly subject = new Subject<RealtimeEvent>();
  private readonly buffers = new Map<string, RealtimeEvent[]>();

  emit(tenantId: string, type: RealtimeEventType, data: Record<string, unknown> = {}): RealtimeEvent {
    const ev: RealtimeEvent = { id: ++this.seq, type, tenantId, at: new Date().toISOString(), data };
    const buf = this.buffers.get(tenantId) ?? [];
    buf.push(ev);
    if (buf.length > BUFFER) buf.shift();
    this.buffers.set(tenantId, buf);
    this.subject.next(ev);
    return ev;
  }

  /** Flujo SSE de un tenant. Reenvia lo perdido si el cliente envia Last-Event-ID. */
  stream(tenantId: string, lastEventId?: number): Observable<{ id: string; type: string; data: RealtimeEvent }> {
    return new Observable((sub) => {
      const hello = { id: 0, type: 'hello' as const, tenantId, at: new Date().toISOString(), data: {} };
      sub.next({ id: String(this.seq), type: 'hello', data: hello });
      if (lastEventId !== undefined && !Number.isNaN(lastEventId)) {
        for (const ev of this.buffers.get(tenantId) ?? []) {
          if (ev.id > lastEventId) sub.next({ id: String(ev.id), type: ev.type, data: ev });
        }
      }
      const s = this.subject.subscribe((ev) => {
        if (ev.tenantId === tenantId) sub.next({ id: String(ev.id), type: ev.type, data: ev });
      });
      const hb = setInterval(() => sub.next({ id: String(this.seq), type: 'ping', data: { ...hello, type: 'hello' } }), 25_000);
      return () => {
        s.unsubscribe();
        clearInterval(hb);
      };
    });
  }
}
