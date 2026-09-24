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

/**
 * Las redes de la tienda, en el pie de todos los correos.
 *
 * Van aquí y no en el CMS por lo mismo que los días de custodia: forman parte
 * de lo que el correo dice, cambian una vez cada varios años, y una consulta a
 * la base por cada correo enviado no se paga con eso. Cuando el panel permita
 * editarlas (MxH-0119), este es el sitio que hay que sustituir.
 *
 * Enlaces canónicos: el de Facebook que se comparte desde la app es un
 * `/share/…` que redirige aquí, y el de Instagram traía un `?stkn=` que es un
 * token de la sesión de quien lo copió y no debe publicarse.
 */
export const REDES: FooterLink[] = [
  {
    label: 'Facebook',
    url: 'https://www.facebook.com/profile.php?id=61550740714835',
  },
  { label: 'Instagram', url: 'https://www.instagram.com/maxihabana' },
];

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
  /** La ficha del pedido en la tienda, para pagarlo y seguirlo. */
  orderUrl: string | null;
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

/**
 * Los importes, con separador de miles.
 *
 * La tienda vende en USD y hay pedidos de cinco cifras: `$51840.00` obliga a
 * contar los dígitos para saber si son cinco mil o cincuenta mil, y el correo
 * del pago es justo donde nadie quiere dudar. El PDF del comprobante ya los
 * escribía así; esto pone de acuerdo a los dos documentos.
 *
 * Separadores en inglés (coma para miles, punto para decimales) porque es la
 * convención de la moneda y la que ya usan la tienda y el panel.
 */
const numero = (valor: string | number): string =>
  Number(valor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const money = (amount: string, currency = 'USD'): string =>
  `${currency === 'USD' ? '$' : ''}${numero(amount)}${currency === 'USD' ? '' : ` ${currency}`}`;

/** Cantidades enteras —pedidos, unidades—: sin decimales, con miles. */
const cantidad = (valor: number): string => valor.toLocaleString('en-US');

const greeting = (name: string | null): string =>
  name ? `Hola, ${esc(name)}:` : 'Hola:';

export interface FooterLink {
  label: string;
  url: string;
}

/**
 * Tono de la franja de estado. Verde para lo que va bien, naranja para lo que
 * cuesta dinero o pide atención: el cliente sabe de qué va el correo antes de
 * leerlo, y con las imágenes bloqueadas —que es como Gmail los abre por
 * defecto— el color sigue ahí.
 */
export type TonoEstado = 'bien' | 'atencion';

const TONOS: Record<TonoEstado, { fondo: string; texto: string }> = {
  bien: { fondo: '#3db98c', texto: '#08291b' },
  atencion: { fondo: '#f2933f', texto: '#3d2408' },
};

/**
 * La marca, en texto y no en imagen.
 *
 * Gmail bloquea las imágenes por defecto: un logo que no carga deja el correo
 * sin firma visual justo en el primer vistazo, que es cuando el cliente decide
 * si esto es suyo o es basura. El nombre escrito siempre se ve.
 */
const cabecera = (): string => `
      <tr><td style="background:#1e3d30;padding:22px 30px;">
        <span style="font-size:22px;font-weight:bold;color:#ffffff;">maxi</span><span style="font-size:22px;font-weight:bold;color:#7fd3af;">Habana</span>
        <span style="float:right;font-size:10px;letter-spacing:1.6px;color:#9dbcab;padding-top:9px;">EN SU PUNTO</span>
      </td></tr>`;

const franja = (estado?: { texto: string; tono: TonoEstado }): string =>
  estado
    ? `
      <tr><td style="background:${TONOS[estado.tono].fondo};padding:9px 30px;font-size:12px;font-weight:bold;letter-spacing:0.4px;color:${TONOS[estado.tono].texto};">${esc(estado.texto)}</td></tr>`
    : '';

/**
 * El pie, igual en todos los correos.
 *
 * Antes solo lo llevaba la bienvenida y las otras siete salían sin política de
 * privacidad, sin términos y sin más contacto que el WhatsApp. Ahora los
 * enlaces los arma el propio layout a partir de la raíz de la tienda, así que
 * ninguna plantilla puede olvidarse de ellos.
 */
const enlacesDelPie = (storeUrl: string | null | undefined): FooterLink[] => {
  if (!storeUrl) return [];
  const raiz = storeUrl.replace(/\/+$/, '');
  return [
    { label: 'Preguntas frecuentes', url: `${raiz}/preguntas-frecuentes` },
    { label: 'Contacto', url: `${raiz}/contacto` },
    { label: 'Métodos de pago', url: `${raiz}/paginas/metodos-de-pagos` },
    { label: 'Privacidad', url: `${raiz}/paginas/politica-de-privacidad` },
    { label: 'Términos', url: `${raiz}/paginas/terminos-y-condiciones` },
  ];
};

const footerLinks = (links: FooterLink[]): string =>
  links.length
    ? `<p style="margin:0 0 10px;font-size:12px;line-height:1.9;">${links
        .map(
          (link) =>
            `<a href="${link.url}" style="color:#ffe1bd;text-decoration:none;">${esc(link.label)}</a>`,
        )
        .join(' &nbsp;·&nbsp; ')}</p>`
    : '';

/**
 * Las redes, en texto y no con iconos: un PNG de Facebook en el pie es una
 * imagen más que Gmail bloquea, y entonces no queda ni el enlace.
 */
const redesDelPie = (): string =>
  `<p style="margin:0 0 10px;font-size:12px;">${REDES.map(
    (red) =>
      `<a href="${red.url}" style="color:#ffe1bd;text-decoration:none;">${esc(red.label)}</a>`,
  ).join(' &nbsp;·&nbsp; ')}</p>`;

export interface LayoutOptions {
  title: string;
  body: string;
  whatsapp: string;
  storeUrl?: string | null;
  estado?: { texto: string; tono: TonoEstado };
  /** Por qué le llega esto: cuenta para no acabar en spam, y es honesto. */
  motivo?: string;
}

const layout = ({
  title,
  body,
  whatsapp,
  storeUrl,
  estado,
  motivo,
}: LayoutOptions): string => `
<!doctype html>
<html lang="es">
<body style="margin:0;padding:20px 0;background:#eceeed;font-family:Helvetica,Arial,sans-serif;color:#2f3b36;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
${cabecera()}${franja(estado)}
        <tr><td style="padding:28px 30px 4px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#14211c;">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:4px 30px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e6ebe8;">
            <tr><td style="padding-top:14px;font-size:13px;line-height:1.7;color:#6b7a73;">
              ¿Alguna duda? Escríbenos por WhatsApp al
              <a href="https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}" style="color:#1e3d30;font-weight:bold;text-decoration:none;">${esc(whatsapp)}</a>
              o responde a este correo.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#14291f;padding:18px 30px;">
          ${footerLinks(enlacesDelPie(storeUrl))}
          ${redesDelPie()}
          <p style="margin:0;font-size:11px;line-height:1.7;color:#8ba394;">
            © ${new Date().getFullYear()} Maxi Habana · La Meknica Export &amp; Import SRL${motivo ? `<br>${esc(motivo)}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/**
 * Las dos versiones del correo desde los mismos datos.
 *
 * El título vive en el layout, así que el texto plano se quedaba sin él —y sin
 * el saludo, cuando el saludo es el título—. Quien lea la versión de texto
 * empezaba en seco, a media frase.
 */
const render = (opts: LayoutOptions): { html: string; text: string } => ({
  html: layout(opts),
  text: strip(`${opts.title}\n\n${opts.body}`),
});

/** Una tabla de clave y valor: lo que el cliente busca, fuera del párrafo. */
const datos = (filas: Array<[string, string]>): string =>
  filas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid #dde5e1;border-radius:8px;">${filas
        .map(
          ([clave, valor], i) =>
            `<tr><td style="padding:11px 16px;font-size:14px;color:#5d6c65;${i ? 'border-top:1px solid #eef2f0;' : ''}">${esc(clave)}</td><td align="right" style="padding:11px 16px;font-size:14px;font-weight:bold;color:#14211c;${i ? 'border-top:1px solid #eef2f0;' : ''}">${valor}</td></tr>`,
        )
        .join('')}</table>`
    : '';

/** Un importe grande: el dato por el que esa persona iba a llamar. */
const destacado = (rotulo: string, valor: string, nota: string): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:2px solid #f2933f;border-radius:8px;background:#fff7ee;">
    <tr><td style="padding:16px 18px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.8px;color:#8a5a1c;font-weight:bold;">${esc(rotulo)}</p>
      <p style="margin:0 0 6px;font-size:28px;font-weight:bold;color:#14211c;line-height:1.1;">${valor}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#4a3a26;">${nota}</p>
    </td></tr>
  </table>`;

const p = (text: string): string =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${text}</p>`;

const box = (text: string): string =>
  `<div style="margin:0 0 16px;padding:14px 16px;background:#fef3c7;border-radius:8px;font-size:15px;line-height:1.6;">${text}</div>`;

const strip = (html: string): string =>
  html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>|<\/div>/g, '\n\n')
    // Las tablas de `datos()` salían pegadas —«PedidoORD-20260199Se recoge
    // en…»— porque al quitar las etiquetas no quedaba nada entre celda y
    // celda. Separador dentro de la fila, salto al acabarla.
    .replace(/<\/td>/g, ': ')
    .replace(/<\/tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    // La última celda de cada fila también deja su separador: se quita.
    .replace(/:[ \t]*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Pago confirmado: el pedido ya se puede recoger. */
/**
 * El pedido acaba de nacer y todavía no está pagado.
 *
 * Es el primer correo que recibe quien compra, y llega en el momento de más
 * dudas: acaba de dar sus datos y no tiene nada en la mano. Por eso lleva el
 * número del pedido —que es lo que le van a pedir si escribe— y el enlace para
 * pagarlo, y por eso dice que la reserva caduca: quien cierra la pestaña
 * creyendo que ya está, pierde el pedido.
 *
 * No promete fecha de entrega ni da instrucciones de pago: eso depende del
 * método que elija y vive en la página del pedido, donde además hay una cuenta
 * atrás de verdad.
 */
export const orderReceived = (order: OrderMailData): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} tenemos tu pedido <strong>${esc(order.orderNumber)}</strong> guardado. Todavía falta el pago: mientras tanto te apartamos los productos.`,
    ),
    datos([
      ['Pedido', esc(order.orderNumber)],
      ...(order.pickupAddress
        ? ([['Se recoge en', esc(order.pickupAddress)]] as Array<
            [string, string]
          >)
        : []),
    ]),
    destacado(
      'TOTAL A PAGAR',
      money(order.total, order.currency),
      'Puedes pagarlo desde la página del pedido.',
    ),
    ...(order.orderUrl ? [button(order.orderUrl, 'Pagar mi pedido')] : []),
    box(
      'La reserva no dura para siempre: si no recibimos el pago a tiempo, el pedido se cancela y los productos vuelven a la tienda. En la página del pedido ves cuánto tiempo te queda.',
    ),
  ].join('\n');

  return {
    subject: `Pedido ${order.orderNumber}: lo tenemos guardado, falta el pago`,
    ...render({
      title: '¡Listo! Tenemos tu pedido',
      body,
      whatsapp: order.whatsapp,
      storeUrl: order.storeUrl,
      estado: { texto: 'PENDIENTE DE PAGO', tono: 'atencion' },
      motivo:
        'Recibes este correo porque acabas de hacer un pedido en Maxi Habana.',
    }),
  };
};

export const paymentReceived = (order: OrderMailData): RenderedEmail => {
  const body = [
    p(
      `${greeting(order.customerName)} recibimos el pago de tu pedido <strong>${esc(order.orderNumber)}</strong> por ${money(order.total, order.currency)}. Ya lo estamos preparando.`,
    ),
    datos([
      ['Pedido', esc(order.orderNumber)],
      ['Total pagado', money(order.total, order.currency)],
      ...(order.pickupAddress
        ? ([['Se recoge en', esc(order.pickupAddress)]] as Array<
            [string, string]
          >)
        : []),
      ['Lo guardamos', `${PICKUP_CUSTODY_DAYS} días desde hoy`],
    ]),
    p(
      `Quien vaya a buscarlo debe llevar su carné de identidad y el número del pedido.`,
    ),
    p(
      `Te avisaremos a los ${PICKUP_REMINDER_DAYS[0]} y a los ${PICKUP_REMINDER_DAYS[1]} días si todavía no lo has recogido.`,
    ),
  ].join('\n');
  const { html, text } = render({
    title: 'Tu pedido está listo para recoger',
    body,
    whatsapp: order.whatsapp,
    storeUrl: order.storeUrl,
    estado: { texto: 'PAGO RECIBIDO', tono: 'bien' },
    motivo: 'Recibes este correo porque hiciste un pedido en Maxi Habana.',
  });
  return {
    subject: `Pedido ${order.orderNumber}: pago recibido y listo para recoger`,
    html,
    text,
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
  const { html, text } = render({
    title: `Tu pedido ${esc(order.orderNumber)} te espera`,
    body,
    whatsapp: order.whatsapp,
    storeUrl: order.storeUrl,
    estado: { texto: `TE QUEDAN ${remaining} DÍAS`, tono: 'atencion' },
    motivo: 'Recibes este correo porque tienes un pedido pagado sin recoger.',
  });
  return {
    subject: `Recordatorio: tu pedido ${order.orderNumber} sigue esperando`,
    html,
    text,
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
  const { html, text } = render({
    title: 'Te devolvimos tu dinero',
    body,
    whatsapp: order.whatsapp,
    storeUrl: order.storeUrl,
    estado: { texto: 'DEVOLUCIÓN COMPLETADA', tono: 'bien' },
    motivo: 'Recibes este correo por una devolución de tu pedido.',
  });
  return {
    subject: `Pedido ${order.orderNumber}: reembolso enviado`,
    html,
    text,
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
  const { html, text } = render({
    title: 'Tu devolución está en trámite',
    body,
    whatsapp: order.whatsapp,
    storeUrl: order.storeUrl,
    estado: { texto: 'DEVOLUCIÓN EN TRÁMITE', tono: 'atencion' },
    motivo: 'Recibes este correo por una devolución de tu pedido.',
  });
  return {
    subject: `Pedido ${order.orderNumber}: devolución en trámite`,
    html,
    text,
  };
};

export interface ContactReplyMailData {
  /** Lo que escribe soporte, en texto plano y con sus saltos. */
  body: string;
  storeUrl: string | null;
  whatsapp: string;
}

/**
 * La respuesta de soporte a un mensaje de contacto.
 *
 * Era el único correo del sistema que no pasaba por aquí: se armaba con un
 * `<div>` suelto en `contact-mail.service.ts`, sin cabecera, sin marca, sin pie
 * y sin decir por qué le llegaba. Justo el correo que recibe alguien que ya
 * escribió con una duda, y el que peor clasifica un filtro.
 *
 * El cuerpo lo teclea una persona del back-office: se escapa entero y se
 * respetan sus saltos de línea, que es como lo escribió.
 */
export const contactReply = (
  data: ContactReplyMailData,
): { html: string; text: string } => {
  const cuerpo = `<div style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#2f3b36;white-space:pre-wrap;">${esc(data.body)}</div>`;

  // Sin `subject`: el asunto lo escribe quien responde desde el back-office,
  // y normalmente es el del mensaje original. La plantilla no se lo inventa.
  return render({
    title: 'Te respondemos',
    body: cuerpo,
    whatsapp: data.whatsapp,
    storeUrl: data.storeUrl,
    estado: { texto: 'RESPUESTA DE MAXI HABANA', tono: 'bien' },
    motivo: 'Recibes este correo porque nos escribiste a través de la tienda.',
  });
};

export interface ClientInvitationMailData {
  customerName: string | null;
  /** Enlace de aceptación de Clerk: es la credencial, no un enlace cualquiera. */
  invitationUrl: string;
  storeUrl: string | null;
  whatsapp: string;
}

/**
 * Alta de un cliente que compró por otro canal y al que damos cuenta nosotros.
 *
 * El correo lo manda la tienda, no Clerk. Clerk sabe mandarlo, pero ya se ha
 * visto aceptar la invitación y no entregar nada —le pasó a un trabajador el
 * 22-sep—, y aquí el enlace es lo único que el cliente tiene para entrar. Con
 * nuestro envío queda registrado en `email_log` y se sabe si salió.
 *
 * No promete nada que no sepamos: ni pedidos, ni saldo, ni historial. Solo dice
 * quién le abrió la cuenta y qué tiene que hacer.
 */
export const clientInvitation = (
  data: ClientInvitationMailData,
): RenderedEmail => {
  const body = [
    p(
      `Te abrimos una cuenta en <strong>Maxi Habana</strong> para que puedas seguir tus pedidos y comprar tú mismo cuando quieras.`,
    ),
    p(
      `Solo falta que elijas tu contraseña. El enlace es personal: no lo compartas.`,
    ),
    button(data.invitationUrl, 'Elegir mi contraseña'),
    p(
      `Si el botón no te funciona, copia esta dirección en tu navegador:<br><span style="word-break:break-all;color:#5d6c65;font-size:13px;">${esc(data.invitationUrl)}</span>`,
    ),
    box(
      'Si no esperabas este correo, puedes ignorarlo: sin elegir contraseña, la cuenta no se activa.',
    ),
  ].join('\n');

  return {
    subject: data.customerName
      ? `${data.customerName}, tu cuenta de Maxi Habana está lista para activar`
      : 'Tu cuenta de Maxi Habana está lista para activar',
    ...render({
      title: data.customerName
        ? `Hola, ${esc(data.customerName)}`
        : 'Te abrimos una cuenta',
      body,
      whatsapp: data.whatsapp,
      storeUrl: data.storeUrl,
      estado: { texto: 'FALTA ACTIVAR TU CUENTA', tono: 'atencion' },
      motivo:
        'Recibes este correo porque alguien de Maxi Habana te abrió una cuenta.',
    }),
  };
};

export interface WelcomeMailData {
  customerName: string | null;
  /** Raíz de la tienda, sin barra final. Los enlaces del pie cuelgan de aquí. */
  storeUrl: string;
  whatsapp: string;
}

const button = (url: string, label: string): string =>
  `<p style="margin:0 0 18px;"><a href="${url}" style="display:inline-block;background:#1e3d30;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:8px;">${label}</a></p>`;

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
    ...render({
      title: 'Tu pedido va en camino',
      body,
      whatsapp: order.whatsapp,
      storeUrl: order.storeUrl,
      estado: { texto: 'EN CAMINO', tono: 'bien' },
      motivo: 'Recibes este correo porque hiciste un pedido en Maxi Habana.',
    }),
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
    ...render({
      title: 'Pedido entregado',
      body,
      whatsapp: order.whatsapp,
      storeUrl: order.storeUrl,
      estado: { texto: 'ENTREGADO', tono: 'bien' },
      motivo: 'Recibes este correo porque hiciste un pedido en Maxi Habana.',
    }),
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
      destacado(
        'TE DEVOLVEMOS',
        money(order.total, order.currency),
        'Vamos a contactarte para acordar cómo hacértelo llegar. El importe queda registrado a tu nombre.',
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

  // El caso del pago tardío sin stock lleva naranja y lo dice en la franja:
  // es el único de los tres en el que hay dinero de por medio.
  const conDevolucion = motivo === 'paid_after_expiry_out_of_stock';
  return {
    subject: `Pedido ${order.orderNumber}: cancelado`,
    ...render({
      title: conDevolucion
        ? 'Tu pago llegó tarde y ya no quedaban existencias'
        : 'Tu pedido se canceló',
      body: cuerpo,
      whatsapp: order.whatsapp,
      storeUrl: order.storeUrl,
      estado: conDevolucion
        ? { texto: 'CANCELADO · TE DEVOLVEMOS EL DINERO', tono: 'atencion' }
        : { texto: 'PEDIDO CANCELADO', tono: 'atencion' },
      motivo: 'Recibes este correo porque hiciste un pedido en Maxi Habana.',
    }),
  };
};

export interface ReportMailData {
  /** Los filtros en palabras, tal como los describe el propio PDF. */
  criterios: string;
  pedidos: number;
  importe: string;
  /** Quién lo pidió, para que el que lo recibe sepa de dónde sale. */
  solicitante: string | null;
  whatsapp: string;
  storeUrl: string | null;
}

/**
 * El reporte de pedidos, que viaja adjunto.
 *
 * Es el único correo del sistema que **no va a un cliente**: va a quien lleva
 * las cuentas. Por eso el cuerpo adelanta las dos cifras que se van a mirar
 * primero —cuántos pedidos y cuánto dinero—, y así se puede responder a un
 * «¿cómo vamos?» desde el móvil sin abrir el PDF.
 */
export const reportReady = (data: ReportMailData): RenderedEmail => {
  const body = [
    p(
      `Aquí tienes el reporte de pedidos que ${data.solicitante ? `pidió ${esc(data.solicitante)}` : 'se ha solicitado'}. Va adjunto en PDF.`,
    ),
    datos([
      ['Criterios', esc(data.criterios)],
      ['Pedidos', cantidad(data.pedidos)],
      ['Importe total', money(data.importe, 'USD')],
    ]),
    p(
      `El detalle, con el listado completo y los totales por estado, está en el documento adjunto.`,
    ),
  ].join('\n');

  return {
    subject: `Reporte de pedidos · ${cantidad(data.pedidos)} pedidos · ${money(data.importe, 'USD')}`,
    ...render({
      title: 'Reporte de pedidos',
      body,
      whatsapp: data.whatsapp,
      storeUrl: data.storeUrl,
      estado: { texto: 'DOCUMENTO INTERNO', tono: 'bien' },
      motivo:
        'Recibes este correo porque alguien del equipo pidió este reporte, o por el rol que tienes asignado en el panel.',
    }),
  };
};

export const welcome = (data: WelcomeMailData): RenderedEmail => {
  const store = data.storeUrl.replace(/\/+$/, '');
  const body = [
    p(
      `Tu cuenta ya está lista, y con ella una forma de estar presente aunque estés lejos.`,
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

  const { html, text } = render({
    title: data.customerName ? `Hola, ${esc(data.customerName)}` : 'Hola',
    body,
    whatsapp: data.whatsapp,
    storeUrl: store,
    estado: { texto: 'TU CUENTA YA ESTÁ LISTA', tono: 'bien' },
    motivo: 'Recibes este correo porque creaste una cuenta en Maxi Habana.',
  });

  return {
    subject: data.customerName
      ? `Bienvenida a Maxi Habana, ${data.customerName} 💚`
      : 'Bienvenida a Maxi Habana 💚',
    html,
    text,
  };
};
