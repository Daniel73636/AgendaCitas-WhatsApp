import { describe, expect, it } from 'vitest';
import { CloudApiWhatsAppClient, MockWhatsAppClient, buildButtonPayload, parseButtonPayload, parseWebhook, renderTemplate } from '../src';

const ID = '0190aaaa-bbbb-7ccc-8ddd-eeeeffff0000';

describe('plantillas', () => {
  it('renderiza variables y botones', () => {
    const r = renderTemplate('appointment_reminder_24h', { name: 'Laura', service: 'Corte', date: 'jue 5 mar', time: '14:00', business: 'Belleza Demo' });
    expect(r.body).toContain('Hola Laura');
    expect(r.body).toContain('14:00');
    expect(r.buttons.map((b) => b.label)).toEqual(['Confirmo', 'Reprogramar', 'Cancelar']);
  });
  it('payload de botones ida y vuelta', () => {
    const p = buildButtonPayload(ID, 'confirm');
    expect(parseButtonPayload(p)).toEqual({ appointmentId: ID, action: 'confirm' });
    expect(parseButtonPayload('hola')).toBeNull();
  });
});

describe('MockWhatsAppClient', () => {
  it('registra en el buzon y en el log', async () => {
    const lines: string[] = [];
    const c = new MockWhatsAppClient((l) => lines.push(l));
    const r = await c.sendTemplate('+573001112233', 'otp_code', { code: '123456' });
    expect(r.ok).toBe(true);
    expect(c.outbox).toHaveLength(1);
    expect(lines[0]).toContain('123456');
  });
  it('numeros terminados en 0000 fallan (para probar degradacion)', async () => {
    const c = new MockWhatsAppClient(() => {});
    const r = await c.sendText('+570000000000', 'hola');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('131026');
  });
});

describe('Cloud API', () => {
  it('arma el payload de plantilla con parametros posicionales y botones', async () => {
    let sent: any;
    const c = new CloudApiWhatsAppClient({
      phoneNumberId: '123',
      accessToken: 't',
      fetchImpl: (async (_url: string, init: any) => {
        sent = JSON.parse(init.body);
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) } as any;
      }) as any,
    });
    const r = await c.sendTemplate('+573001112233', 'appointment_reminder_24h', { name: 'Laura', service: 'Corte', date: 'x', time: '10:00', business: 'B' }, { appointmentId: ID });
    expect(r).toMatchObject({ ok: true, waMessageId: 'wamid.1' });
    expect(sent.to).toBe('573001112233');
    expect(sent.template.components[0].parameters).toHaveLength(5);
    expect(sent.template.components[1].parameters[0].payload).toBe(`apt:${ID}:confirm`);
  });
});

describe('webhook', () => {
  it('parsea botones, texto y estados', () => {
    const ev = parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'm1', from: '573001112233', type: 'button', button: { payload: `apt:${ID}:confirm`, text: 'Confirmo' } },
                  { id: 'm2', from: '573001112233', type: 'text', text: { body: 'hola' } },
                ],
                statuses: [{ id: 'm0', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });
    expect(ev.map((e) => e.type)).toEqual(['button', 'text', 'status']);
    expect((ev[0] as any).from).toBe('+573001112233');
  });
});
