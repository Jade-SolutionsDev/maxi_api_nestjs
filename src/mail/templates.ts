/**
 * Plantillas de los correos que salen al cliente.
 *
 * Español de Cuba y tuteo, como manda el CLAUDE.md del repo. HTML sencillo y
 * con estilos en línea: los clientes de correo no cargan hojas de estilo.
 *
 * Las constantes de política viven aquí porque son lo que el correo promete;
 * si cambian, cambian a la vez el texto y la tarea que lo manda.
 */

/** Días que se guarda un pedido pagado antes de que venza la custodia. */
export const PICKUP_CUSTODY_DAYS = 30;

/** Hitos en los que se avisa al cliente de que su pedido sigue esperando. */
export const PICKUP_REMINDER_DAYS = [15, 25] as const;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface OrderMailData {
  orderNumber: string;
  customerName: string | null;
  total: string;
  currency: string;
  /** Dirección del mostrador donde se recoge, ya formateada. */
  pickupAddress: string | null;
  whatsapp: string;
  storeUrl: string | null;
}

/**
 * Todo lo que no es literal se escapa antes de entrar en el HTML: el nombre
 * del cliente lo escribe él mismo al registrarse, y la dirección de la
 * devolución la teclea alguien del back-office. Un `<` suelto rompería el
 * correo, y algo peor que un `<` no debería llegar nunca a la bandeja de
 * nadie.
 */
const esc = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (amount: string, currency = 'USD'): string =>
  `${currency === 'USD' ? '$' : ''}${Number(amount).toFixed(2)}${currency === 'USD' ? '' : ` ${currency}`}`;

const greeting = (name: string | null): string =>
  name ? `Hola, ${esc(name)}:` : 'Hola:';

const layout = (title: string, body: string, whatsapp: string): string => `
<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#1c1917;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <tr><td>
      <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#1c1917;">${title}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:28px 0 16px;">
      <p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">
        ¿Alguna duda? Escríbenos por WhatsApp al
        <a href="https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}" style="color:#b45309;">${esc(whatsapp)}</a>.
      </p>
    </td></tr>
  </table>
</body>
</html>`;

const p = (text: string): string =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${text}</p>`;

const box = (text: string): string =>
  `<div style="margin:0 0 16px;padding:14px 16px;background:#fef3c7;border-radius:8px;font-size:15px;line-height:1.6;">${text}</div>`;

const strip = (html: string): string =>
  html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>|<\/div>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Pago confirmado: el pedido ya se puede recoger. */
export const paymentReceived = (order: OrderMailData): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} recibimos el pago de tu pedido <strong>${esc(order.orderNumber)}</strong> por ${money(order.total, order.currency)}. Ya lo estamos preparando.`,
    ),
    order.pickupAddress
      ? box(`<strong>Dónde recogerlo</strong><br>${esc(order.pickupAddress)}`)
      : '',
    p(
      `Quien vaya a buscarlo debe llevar su carné de identidad y el número del pedido.`,
    ),
    p(
      `Guardamos tu pedido durante <strong>${PICKUP_CUSTODY_DAYS} días</strong> contados desde hoy. Te avisaremos a los ${PICKUP_REMINDER_DAYS[0]} y a los ${PICKUP_REMINDER_DAYS[1]} días si todavía no lo has recogido.`,
    ),
  ].join('\n');
  const html = layout(
    'Tu pedido está listo para recoger',
    body,
    order.whatsapp,
  );
  return {
    subject: `Pedido ${order.orderNumber}: pago recibido y listo para recoger`,
    html,
    text: strip(body),
  };
};

/** Recordatorio de que el pedido sigue esperando en el mostrador. */
export const pickupReminder = (
  order: OrderMailData,
  daysSincePayment: number,
): RenderedEmail => {
  const remaining = PICKUP_CUSTODY_DAYS - daysSincePayment;
  const body = [
    p(
      `${greeting(order.customerName)} tu pedido <strong>${esc(order.orderNumber)}</strong> sigue esperando en nuestro mostrador. Lo pagaste hace ${daysSincePayment} días.`,
    ),
    order.pickupAddress
      ? box(`<strong>Dónde recogerlo</strong><br>${esc(order.pickupAddress)}`)
      : '',
    p(
      `Te quedan <strong>${remaining} días</strong> para recogerlo. Pasados los ${PICKUP_CUSTODY_DAYS} días desde el pago, el pedido sigue siendo tuyo, pero te lo entregamos en el estado en que esté y ya no podemos reponerlo ni devolverte el importe.`,
    ),
    p(
      `Si no puedes ir tú, puede recogerlo otra persona: solo necesita su carné y el número del pedido.`,
    ),
  ].join('\n');
  const html = layout(
    `Tu pedido ${esc(order.orderNumber)} te espera`,
    body,
    order.whatsapp,
  );
  return {
    subject: `Recordatorio: tu pedido ${order.orderNumber} sigue esperando`,
    html,
    text: strip(body),
  };
};

export interface RefundMailData {
  amount: string;
  currency: string;
  destination: string | null;
  providerRef: string | null;
  partial: boolean;
}

/** El dinero salió: aviso con el importe y a dónde se envió. */
export const refundCompleted = (
  order: OrderMailData,
  refund: RefundMailData,
): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} te devolvimos ${money(refund.amount, refund.currency)} del pedido <strong>${esc(order.orderNumber)}</strong>.`,
    ),
    refund.partial
      ? p(`Es una devolución parcial: el resto del pedido sigue en pie.`)
      : '',
    refund.destination
      ? box(
          `<strong>Enviado a</strong><br><span style="font-family:monospace;font-size:13px;word-break:break-all;">${esc(refund.destination)}</span>${refund.providerRef ? `<br><br><strong>Referencia</strong><br><span style="font-family:monospace;font-size:13px;word-break:break-all;">${esc(refund.providerRef)}</span>` : ''}`,
        )
      : '',
    p(
      `Si no lo ves reflejado en las próximas horas, escríbenos y lo revisamos contigo.`,
    ),
  ].join('\n');
  const html = layout('Te devolvimos tu dinero', body, order.whatsapp);
  return {
    subject: `Pedido ${order.orderNumber}: reembolso enviado`,
    html,
    text: strip(body),
  };
};

/** Se aceptó la devolución y hace falta la dirección a la que enviarla. */
export const refundRequested = (
  order: OrderMailData,
  refund: RefundMailData,
): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} estamos tramitando la devolución de ${money(refund.amount, refund.currency)} de tu pedido <strong>${esc(order.orderNumber)}</strong>.`,
    ),
    refund.destination
      ? p(`Lo enviaremos a la dirección que nos diste.`)
      : box(
          `<strong>Necesitamos una dirección</strong><br>Respóndenos por WhatsApp con tu dirección <strong>USDT en red BEP20</strong>. Es la única red por la que podemos devolver; enviar a otra red no tiene vuelta atrás.`,
        ),
    p(
      `En cuanto salga el envío te avisamos con la referencia de la transacción.`,
    ),
  ].join('\n');
  const html = layout('Tu devolución está en trámite', body, order.whatsapp);
  return {
    subject: `Pedido ${order.orderNumber}: devolución en trámite`,
    html,
    text: strip(body),
  };
};
