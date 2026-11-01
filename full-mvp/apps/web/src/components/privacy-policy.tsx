import { PRIVACY_POLICY_VERSION } from '@agenda/contracts';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export interface PrivacyResponsible {
  name: string;
  phone?: string | null;
  address?: string | null;
}

/** Política de tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013). */
export function PrivacyPolicy({ responsible, backHref }: { responsible?: PrivacyResponsible | null; backHref: string }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8 pb-16">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft size={16} /> Volver</Link>
      <h1 className="text-2xl font-bold">Política de privacidad</h1>
      <p className="mb-6 text-sm text-muted-foreground">Tratamiento de datos personales · Versión {PRIVACY_POLICY_VERSION}</p>

      <div className="flex flex-col gap-5 text-sm leading-relaxed">
        <section>
          <h2 className="mb-1 text-base font-semibold">1. Responsable del tratamiento</h2>
          {responsible ? (
            <p>
              <b>{responsible.name}</b>
              {responsible.address ? <> · {responsible.address}</> : null}
              {responsible.phone ? <> · Tel./WhatsApp: {responsible.phone}</> : null}. La plataforma de agendamiento actúa como encargada del tratamiento por cuenta del negocio.
            </p>
          ) : (
            <p>El responsable es el negocio con el que agendas tu cita (sus datos de contacto aparecen en su página de reservas). La plataforma de agendamiento actúa como encargada del tratamiento.</p>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">2. Datos que recolectamos</h2>
          <p>Nombre, número de celular, correo electrónico (opcional), servicios y horarios que reservas, notas que nos indiques y el historial de mensajes de WhatsApp relacionados con tu cita. No recolectamos datos sensibles.</p>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">3. Finalidades</h2>
          <ul className="list-disc pl-5">
            <li>Crear, confirmar, reprogramar y cancelar tu cita.</li>
            <li>Verificar tu celular con un código de un solo uso.</li>
            <li>Enviarte confirmaciones y recordatorios por WhatsApp (solo si lo autorizas).</li>
            <li>Ofrecerte un cupo si te inscribes en la lista de espera.</li>
            <li>Llevar el control de asistencia y la facturación del negocio.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">4. Tus derechos</h2>
          <p>Como titular puedes conocer, actualizar y rectificar tus datos, solicitar prueba de la autorización, ser informado del uso que se les da, presentar quejas ante la Superintendencia de Industria y Comercio, revocar la autorización y solicitar la supresión de tus datos, y acceder a ellos de forma gratuita.</p>
          <p className="mt-2">Para ejercerlos, escribe al negocio por los datos de contacto de arriba. El negocio puede entregarte una copia de tus datos (archivo JSON) o suprimirlos desde su panel. Responderemos en los plazos de la ley (consultas: 10 días hábiles; reclamos: 15 días hábiles).</p>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">5. Supresión y conservación</h2>
          <p>Al suprimir tus datos eliminamos tu nombre, celular, correo, notas, mensajes y códigos de verificación. Las citas pasadas se conservan sin datos que te identifiquen, para fines contables y estadísticos.</p>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">6. Seguridad</h2>
          <p>Las notas se cifran en reposo, los códigos de verificación se guardan con hash, el acceso al panel está protegido con contraseña y bloqueo por intentos fallidos, y cada negocio solo puede ver sus propios datos.</p>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold">7. Autorización</h2>
          <p>Al marcar la casilla de autorización en el formulario de reserva aceptas esta política. Guardamos la fecha y la versión de la política que aceptaste. La autorización para recibir mensajes de WhatsApp es independiente y opcional.</p>
        </section>
      </div>
    </main>
  );
}
