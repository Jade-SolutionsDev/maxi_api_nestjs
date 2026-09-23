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

export interface FooterLink {
  label: string;
  url: string;
}

const footerLinks = (links: FooterLink[]): string =>
  links.length
    ? `<p style="margin:0 0 12px;font-size:12.5px;line-height:1.9;">${links
        .map(
          (link) =>
            `<a href="${link.url}" style="color:#ffe1bd;text-decoration:none;">${esc(link.label)}</a>`,
        )
        .join(' &nbsp;·&nbsp; ')}</p>`
    : '';

const layout = (
  title: string,
  body: string,
  whatsapp: string,
  links: FooterLink[] = [],
): string => `
<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#1c1917;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <tr><td>
      <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#1c1917;">${title}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:28px 0 16px;">
      ${footerLinks(links)}
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

export interface WelcomeMailData {
  customerName: string | null;
  /** Raíz de la tienda, sin barra final. Los enlaces del pie cuelgan de aquí. */
  storeUrl: string;
  whatsapp: string;
}

const button = (url: string, label: string): string =>
  `<p style="margin:0 0 18px;"><a href="${url}" style="display:inline-block;background:#3db98c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px;">${label}</a></p>`;

/**
 * Bienvenida al crear la cuenta.
 *
 * Bienvenida y nada más: sin catálogo, sin instrucciones de pago y sin
 * dirección de recogida. Todo eso llega en los correos de cada pedido, que es
 * donde hace falta; aquí solo estorbaría.
 *
 * El texto habla de lo que trae al cliente, que no es el producto: alguien que
 * compra desde fuera para su familia en Cuba.
 */
/**
 * Motivo por el que se canceló, para elegir qué se le cuenta al cliente.
 * `null` es la cancelación ordinaria —la pidió él o la hizo el back-office— y
 * es el caso más frecuente: decirle ahí que «se le caducó la reserva» sería
 * contarle algo que no pasó.
 */
export type MotivoCancelacion =
  | null
  | 'payment_not_received'
  | 'paid_after_expiry_out_of_stock';

/** El pedido salió hacia su destino. */
export const orderShipped = (order: OrderMailData): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} tu pedido <strong>${esc(order.orderNumber)}</strong> ya salió y va en camino.`,
    ),
    p(
      `Quien lo reciba debe llevar su carné de identidad y el número del pedido.`,
    ),
  ].join('\n');
  return {
    subject: `Pedido ${order.orderNumber}: va en camino`,
    html: layout('Tu pedido va en camino', body, order.whatsapp),
    text: strip(body),
  };
};

/** Se entregó: cierra el ciclo y sirve de comprobante. */
export const orderDelivered = (order: OrderMailData): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} tu pedido <strong>${esc(order.orderNumber)}</strong> fue entregado. Gracias por comprar con nosotros.`,
    ),
    p(
      `Si algo no está como esperabas, escríbenos y lo miramos: guardamos el registro de cada pedido.`,
    ),
  ].join('\n');
  return {
    subject: `Pedido ${order.orderNumber}: entregado`,
    html: layout('Pedido entregado', body, order.whatsapp),
    text: strip(body),
  };
};

/**
 * Se canceló. Tres motivos y tres textos: el genérico no sirve para los otros
 * dos, y sobre todo no sirve al revés —a quien canceló él mismo no se le puede
 * decir que se le venció un plazo—.
 */
export const orderCancelled = (
  order: OrderMailData,
  motivo: MotivoCancelacion,
): RenderedEmail => {
  const cuerpo = {
    payment_not_received: [
      p(
        `${greeting(order.customerName)} tu pedido <strong>${esc(order.orderNumber)}</strong> se canceló porque no llegamos a recibir el pago dentro del plazo.`,
      ),
      p(
        `Los productos que tenías apartados volvieron a la venta. No se te cobró nada.`,
      ),
      p(`Si todavía lo quieres, puedes hacer el pedido otra vez.`),
    ],
    paid_after_expiry_out_of_stock: [
      p(
        `${greeting(order.customerName)} recibimos tu pago del pedido <strong>${esc(order.orderNumber)}</strong>, pero llegó después de que venciera el plazo y para entonces ya no quedaban existencias.`,
      ),
      box(
        `<strong>Tu dinero se te devuelve.</strong> Vamos a contactarte para acordar cómo, y mientras tanto el importe de ${money(order.total, order.currency)} queda registrado a tu nombre.`,
      ),
      p(
        `Sentimos el trastorno. Si prefieres otro producto en lugar de la devolución, dínoslo y lo arreglamos.`,
      ),
    ],
    ordinaria: [
      p(
        `${greeting(order.customerName)} tu pedido <strong>${esc(order.orderNumber)}</strong> quedó cancelado.`,
      ),
      p(`No se te cobró nada, y lo que tenías apartado volvió a la venta.`),
      p(`Si no fuiste tú quien lo canceló, escríbenos y lo revisamos.`),
    ],
  }[motivo ?? 'ordinaria'].join('\n');

  return {
    subject: `Pedido ${order.orderNumber}: cancelado`,
    html: layout('Tu pedido se canceló', cuerpo, order.whatsapp),
    text: strip(cuerpo),
  };
};

export const welcome = (data: WelcomeMailData): RenderedEmail => {
  const store = data.storeUrl.replace(/\/+$/, '');
  const body = [
    p(
      `${greeting(data.customerName)} tu cuenta ya está lista, y con ella una forma de estar presente aunque estés lejos.`,
    ),
    p(
      `Detrás de cada pedido que pasa por aquí hay alguien pensando en su gente: una madre, un hermano, unos hijos que siguen allá. La distancia cambia muchas cosas, pero no esa.`,
    ),
    p(
      `<strong>Lo que nos toca a nosotros es sencillo, y no lo tomamos a la ligera: que lo que compres llegue a manos de los tuyos.</strong>`,
    ),
    p(`Gracias por confiarnos eso. Aquí estamos cuando nos necesites.`),
    button(store, 'Entrar a mi cuenta'),
    p(`Con cariño,<br><strong>El equipo de Maxi Habana</strong>`),
  ].join('\n');

  const html = layout('¡Bienvenido a Maxi Habana!', body, data.whatsapp, [
    { label: 'Preguntas frecuentes', url: `${store}/preguntas-frecuentes` },
    { label: 'Contacto', url: `${store}/contacto` },
    { label: 'Métodos de pago', url: `${store}/paginas/metodos-de-pagos` },
    { label: 'Privacidad', url: `${store}/paginas/politica-de-privacidad` },
    { label: 'Términos', url: `${store}/paginas/terminos-y-condiciones` },
  ]);

  return {
    subject: data.customerName
      ? `Bienvenida a Maxi Habana, ${data.customerName} 💚`
      : 'Bienvenida a Maxi Habana 💚',
    html,
    text: strip(body),
  };
};
