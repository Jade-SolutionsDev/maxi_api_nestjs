import { RenderedEmail } from '../mail/templates';
import { TicketPriority } from './entities/ticket.entity';

export interface TicketMailData {
  title: string;
  description: string;
  categoryLabel: string | null;
  priority: TicketPriority;
  openedBy: string | null;
  assignedName: string | null;
  /** Dirección del panel, para el enlace. Sin ella no se pone enlace. */
  adminUrl?: string | null;
  ticketId: string;
}

const PRIORIDAD: Record<TicketPriority, string> = {
  [TicketPriority.BAJA]: 'Baja',
  [TicketPriority.MEDIA]: 'Media',
  [TicketPriority.ALTA]: 'Alta',
};

const esc = (valor: string | null | undefined): string =>
  (valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const recortar = (texto: string, tope = 600): string =>
  texto.length > tope ? `${texto.slice(0, tope).trimEnd()}…` : texto;

/**
 * El aviso de que te asignaron un ticket (MxH-0065).
 *
 * **No usa la plantilla de la tienda**, y es a propósito: ese diseño lleva el
 * pie con el WhatsApp de atención, las redes y un «recibes este correo
 * porque…» escrito para un cliente. Esto va a un compañero de trabajo, y
 * mandarle el envoltorio comercial de la tienda confunde de quién es el
 * mensaje. Aquí cabe lo justo: qué es, de qué prioridad, quién lo abrió y el
 * enlace para abrirlo.
 *
 * Tampoco repite la descripción entera: se recorta a 600 caracteres. El correo
 * es un aviso para que entres, no el sitio donde se lee la incidencia — y una
 * descripción larga pegada en un correo envejece en cuanto alguien la edita.
 */
export const ticketAsignado = (data: TicketMailData): RenderedEmail => {
  const enlace = data.adminUrl
    ? `${data.adminUrl.replace(/\/+$/, '')}/tickets/${data.ticketId}`
    : null;

  const filas: Array<[string, string]> = [
    ['Prioridad', PRIORIDAD[data.priority]],
    ['Categoría', data.categoryLabel ?? 'Sin categoría'],
    ['Lo abrió', data.openedBy ?? 'Alguien del equipo'],
  ];

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#71717a">Ticket interno</p>
    <h1 style="margin:0 0 16px;font-size:18px;line-height:1.35">${esc(data.title)}</h1>
    <table style="border-collapse:collapse;margin:0 0 16px;font-size:14px">
      ${filas
        .map(
          ([rotulo, valor]) =>
            `<tr><td style="padding:2px 16px 2px 0;color:#71717a">${esc(rotulo)}</td><td style="padding:2px 0">${esc(valor)}</td></tr>`,
        )
        .join('\n      ')}
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;white-space:pre-line">${esc(recortar(data.description))}</p>
    ${
      enlace
        ? `<p style="margin:0"><a href="${esc(enlace)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Abrir el ticket</a></p>`
        : ''
    }
  </div>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#71717a">Recibes este correo porque te asignaron este ticket en el panel de Maxi Habana.</p>
</body></html>`;

  const text = [
    `Te asignaron un ticket interno: ${data.title}`,
    '',
    ...filas.map(([rotulo, valor]) => `${rotulo}: ${valor}`),
    '',
    recortar(data.description),
    ...(enlace ? ['', `Abrir el ticket: ${enlace}`] : []),
  ].join('\n');

  return {
    subject: `Te asignaron un ticket: ${data.title}`,
    html,
    text,
  };
};
