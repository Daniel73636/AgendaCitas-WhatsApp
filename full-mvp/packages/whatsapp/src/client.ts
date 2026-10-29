import { type TemplateButton, type TemplateName, type TemplateParams, buildButtonPayload, renderTemplate } from './templates';

export interface SendResult {
  ok: boolean;
  waMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Texto efectivamente enviado (o simulado). */
  body: string;
}

export interface SendOptions {
  /** Para generar payloads de botones que referencian la cita. */
  appointmentId?: string;
}

export interface WhatsAppClient {
  readonly mode: 'mock' | 'cloud';
  sendTemplate(toE164: string, template: TemplateName, params: TemplateParams, opts?: SendOptions): Promise<SendResult>;
  sendText(toE164: string, body: string): Promise<SendResult>;
}

export interface MockSent {
  to: string;
  template: TemplateName | null;
  body: string;
  buttons: Array<TemplateButton & { payload?: string }>;
  at: string;
  waMessageId: string;
}

/** Cliente simulado: no sale a la red; registra en consola y conserva un buzon en memoria. */
export class MockWhatsAppClient implements WhatsAppClient {
  readonly mode = 'mock' as const;
  readonly outbox: MockSent[] = [];
  private seq = 0;
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}

  async sendTemplate(to: string, template: TemplateName, params: TemplateParams, opts?: SendOptions): Promise<SendResult> {
    const r = renderTemplate(template, params);
    return this.deliver(to, template, r.body, r.buttons.map((b) => ({ ...b, ...(opts?.appointmentId ? { payload: buildButtonPayload(opts.appointmentId, b.id) } : {}) })));
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    return this.deliver(to, null, body, []);
  }

  private deliver(to: string, template: TemplateName | null, body: string, buttons: MockSent['buttons']): SendResult {
    // Numeros terminados en 0000 simulan fallo de entrega (para probar reintentos / respaldo)
    if (to.endsWith('0000')) {
      this.log(`[WhatsApp MOCK] ✗ FALLO -> ${to} (${template ?? 'texto'}): numero sin WhatsApp`);
      return { ok: false, errorCode: '131026', errorMessage: 'Numero sin WhatsApp (simulado)', body };
    }
    const waMessageId = `mock.${Date.now().toString(36)}.${++this.seq}`;
    this.outbox.push({ to, template, body, buttons, at: new Date().toISOString(), waMessageId });
    if (this.outbox.length > 500) this.outbox.shift();
    const btn = buttons.length ? `  [${buttons.map((b) => b.label).join(' | ')}]` : '';
    this.log(`[WhatsApp MOCK] ✓ -> ${to} ${template ? `(${template})` : '(texto)'}: ${body}${btn}`);
    return { ok: true, waMessageId, body };
  }
}

export interface CloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

/** Cliente de la WhatsApp Cloud API de Meta (plantillas aprobadas con parametros posicionales). */
export class CloudApiWhatsAppClient implements WhatsAppClient {
  readonly mode = 'cloud' as const;
  constructor(private readonly cfg: CloudConfig) {}

  private async post(payload: unknown, body: string): Promise<SendResult> {
    const f = this.cfg.fetchImpl ?? fetch;
    const url = `https://graph.facebook.com/${this.cfg.apiVersion ?? 'v21.0'}/${this.cfg.phoneNumberId}/messages`;
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { code?: number; message?: string } };
      if (!res.ok) {
        return { ok: false, errorCode: String(json.error?.code ?? res.status), errorMessage: json.error?.message ?? res.statusText, body };
      }
      const id = json.messages?.[0]?.id;
      return { ok: true, ...(id ? { waMessageId: id } : {}), body };
    } catch (e) {
      return { ok: false, errorCode: 'NETWORK', errorMessage: (e as Error).message, body };
    }
  }

  sendTemplate(to: string, template: TemplateName, params: TemplateParams, opts?: SendOptions): Promise<SendResult> {
    const r = renderTemplate(template, params);
    const components: unknown[] = [
      { type: 'body', parameters: r.orderedParams.map((text) => ({ type: 'text', text })) },
    ];
    if (opts?.appointmentId) {
      r.buttons.forEach((b, index) => {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload: buildButtonPayload(opts.appointmentId!, b.id) }],
        });
      });
    }
    return this.post(
      {
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: { name: template, language: { code: this.cfg.language ?? 'es' }, components },
      },
      r.body,
    );
  }

  sendText(to: string, body: string): Promise<SendResult> {
    return this.post({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body } }, body);
  }
}

export interface FactoryConfig {
  mode?: string | undefined;
  phoneNumberId?: string | undefined;
  accessToken?: string | undefined;
  log?: ((l: string) => void) | undefined;
}

export function createWhatsAppClient(cfg: FactoryConfig = {}): WhatsAppClient {
  if (cfg.mode === 'cloud' && cfg.phoneNumberId && cfg.accessToken) {
    return new CloudApiWhatsAppClient({ phoneNumberId: cfg.phoneNumberId, accessToken: cfg.accessToken });
  }
  return new MockWhatsAppClient(cfg.log);
}
