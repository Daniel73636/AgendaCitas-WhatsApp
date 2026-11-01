# WhatsApp Cloud API — pasos manuales (AgendaCitas)

El mock (`WHATSAPP_MODE=mock`) es el valor por defecto y sirve para demos locales.
Para producción real, activa `WHATSAPP_MODE=cloud` y completa lo siguiente en Meta.

## 1. Meta Business

1. Crea o usa una [cuenta Meta Business](https://business.facebook.com/).
2. En **Meta for Developers**, crea una app de tipo **Business** y añade el producto **WhatsApp**.
3. Vincula un número de WhatsApp Business (prueba o producción).
4. Anota: **Phone number ID**, **WhatsApp Business Account ID**, **App ID**.

## 2. Tokens y secretos

| Variable | Dónde obtenerla |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token del sistema (permanente) o token de usuario de larga duración |
| `WHATSAPP_PHONE_NUMBER_ID` | Consola WhatsApp → API Setup |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App Secret (firma `X-Hub-Signature-256`) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Cadena que **tú** defines; la misma en Meta al suscribir el webhook |

En `NODE_ENV=production` con `WHATSAPP_MODE=cloud` la API **no arranca** sin phone id, access token y app secret.

## 3. Webhook

1. URL pública HTTPS: `https://<api>/v1/webhooks/whatsapp`
2. Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
3. Suscribe el campo `messages`
4. La API valida la firma HMAC-SHA256 del cuerpo crudo; sin firma válida responde 403

## 4. Plantillas a aprobar (español Colombia)

Aprueba en Meta Business Manager plantillas con nombres alineados al código (`packages/whatsapp`):

- `otp_code` — utilidad / autenticación (código de 6 dígitos)
- `appointment_reminder_24h` — recordatorio con botones Confirmo / Reprogramar / Cancelar
- `appointment_reminder_2h` — recordatorio corto
- `waitlist_offer` — oferta de hueco liberado
- Otras que uses en `templates.ts`

Los botones deben enviar payload `apt:<uuid>:<action>` (ver `buildButtonPayload`).

## 5. Opt-in y ventana de 24 h

- Solo envía plantillas fuera de la ventana de 24 h a números con consentimiento explícito.
- Dentro de la ventana puedes responder con mensajes de sesión.
- En AgendaCitas el consentimiento WhatsApp y el de Ley 1581 son casillas distintas en la reserva pública.

## 6. Checklist rápido

- [ ] App Meta + WhatsApp product
- [ ] Número verificado
- [ ] Plantillas aprobadas
- [ ] Webhook con verify token y firma
- [ ] Variables en el hosting (`DEMO_MODE=false`)
- [ ] Probar OTP real a un celular propio
- [ ] Probar Confirmo / Cancelar desde el celular del cliente
