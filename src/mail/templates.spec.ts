import {
  OrderMailData,
  orderCancelled,
  orderDelivered,
  orderShipped,
  orderReceived,
  paymentReceived,
  refundCompleted,
  welcome,
} from './templates';

const order: OrderMailData = {
  orderNumber: 'ORD-20260001',
  customerName: 'Eduardo Rodríguez',
  total: '60.00',
  currency: 'USD',
  pickupAddress: 'Calle 23 esq. 43, Cárdenas',
  whatsapp: '+53 5251 9414',
  storeUrl: null,
  orderUrl: null,
};

describe('plantillas de correo', () => {
  it('escapa lo que escriben las personas, no lo mete crudo en el HTML', () => {
    const rendered = paymentReceived({
      ...order,
      customerName: '<script>alert(1)</script>',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('escapa también la dirección de la devolución', () => {
    const rendered = refundCompleted(order, {
      amount: '60.00',
      currency: 'USD',
      destination: '0x<img src=x onerror=alert(1)>',
      providerRef: null,
      partial: false,
    });
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
  });

  it('el correo de recogida dice a nombre de quién está el pedido', () => {
    const rendered = paymentReceived({
      ...order,
      recipient: { name: 'Ana Pérez', idCard: '85042312345' },
    });

    // Quien va a buscarlo suele no ser quien compró: si el correo no lo dice,
    // el familiar llega al mostrador sin saber si puede retirarlo.
    expect(rendered.text).toContain('Ana Pérez');
    expect(rendered.text).toContain('85042312345');
  });

  it('sin carnet registrado, el correo no inventa un paréntesis vacío', () => {
    const rendered = paymentReceived({
      ...order,
      recipient: { name: 'Ana Pérez', idCard: null },
    });

    expect(rendered.text).toContain('Ana Pérez');
    expect(rendered.text).not.toContain('()');
  });

  it('un pedido sin destinatario registrado no enseña la fila', () => {
    const rendered = paymentReceived(order);

    expect(rendered.text).not.toContain('Lo recoge');
  });

  it('tutea, como el resto de lo que ve el cliente', () => {
    const rendered = paymentReceived(order);
    expect(rendered.text).toContain('tu pedido');
    expect(rendered.text).not.toMatch(/\b(pagá|recogé|escribinos|tenés)\b/);
  });

  it('el asunto lleva el número de pedido', () => {
    expect(paymentReceived(order).subject).toContain('ORD-20260001');
  });

  describe('bienvenida', () => {
    const datos = {
      customerName: 'Marisol',
      storeUrl: 'https://www.maxihabana.com',
      whatsapp: '+53 5251 9414',
    };

    it('es una bienvenida, no un manual: ni catálogo, ni pago, ni dirección', () => {
      const texto = welcome(datos).text.toLowerCase();
      expect(texto).not.toContain('catálogo');
      expect(texto).not.toContain('usdt');
      expect(texto).not.toContain('bep20');
      expect(texto).not.toContain('cárdenas');
      expect(texto).not.toContain('recoge');
    });

    it('saluda por el nombre y lo lleva en el asunto', () => {
      const rendered = welcome(datos);
      // El saludo es ahora el titular del correo, sin dos puntos.
      expect(rendered.text).toMatch(/^Hola, Marisol/);
      expect(rendered.subject).toContain('Marisol');
    });

    it('sin nombre el saludo sigue teniendo sentido', () => {
      const rendered = welcome({ ...datos, customerName: null });
      expect(rendered.text).toMatch(/^Hola\b/);
      expect(rendered.subject).toBe('Bienvenida a Maxi Habana 💚');
    });

    it('el pie lleva las páginas reales de la tienda', () => {
      const html = welcome(datos).html;
      for (const ruta of [
        '/preguntas-frecuentes',
        '/contacto',
        '/paginas/metodos-de-pagos',
        '/paginas/politica-de-privacidad',
        '/paginas/terminos-y-condiciones',
      ]) {
        expect(html).toContain(`https://www.maxihabana.com${ruta}`);
      }
    });

    it('no duplica la barra cuando la tienda viene con una al final', () => {
      const html = welcome({
        ...datos,
        storeUrl: 'https://www.maxihabana.com/',
      }).html;
      expect(html).not.toContain('.com//');
    });
  });
  describe('cancelación: tres motivos, tres textos', () => {
    // El error caro aquí es contarle a alguien lo que no le pasó. Quien
    // cancela su propio pedido y recibe «no recibimos tu pago» concluye que el
    // sistema no se entera de lo que hace.
    it('al que canceló él mismo no le habla de plazos ni de pagos', () => {
      const r = orderCancelled(order, null);
      expect(r.text).toContain('quedó cancelado');
      expect(r.text).not.toMatch(/plazo|no llegamos a recibir el pago/i);
      expect(r.text).toContain('Si no fuiste tú');
    });

    it('al que no pagó a tiempo le dice que no se le cobró y puede repetirlo', () => {
      const r = orderCancelled(order, 'payment_not_received');
      expect(r.text).toMatch(/no llegamos a recibir el pago/i);
      expect(r.text).toContain('No se te cobró nada');
      expect(r.text).not.toMatch(/te lo devolvemos|devolución/i);
    });

    it('al que pagó y se quedó sin stock le dice que se le devuelve, con el importe', () => {
      const r = orderCancelled(order, 'paid_after_expiry_out_of_stock');
      expect(r.text).toMatch(/te devolvemos/i);
      expect(r.text).toContain('$60.00');
      expect(r.text).not.toContain('No se te cobró nada');
    });
  });

  it('los tres avisos de estado llevan el número de pedido en el asunto', () => {
    expect(orderShipped(order).subject).toContain('ORD-20260001');
    expect(orderDelivered(order).subject).toContain('ORD-20260001');
    expect(orderCancelled(order, null).subject).toContain('ORD-20260001');
  });

  describe('pedido recibido: el primero, y todavía sin pagar', () => {
    const conTienda: OrderMailData = {
      ...order,
      storeUrl: 'https://www.maxihabana.com',
      orderUrl: 'https://www.maxihabana.com/pedidos/abc-123',
    };

    it('lleva el número del pedido y el total, que es lo que le van a pedir', () => {
      const { subject, html } = orderReceived(conTienda);

      expect(subject).toContain('ORD-20260001');
      expect(html).toContain('ORD-20260001');
      expect(html).toContain('$60.00');
    });

    it('lleva el botón para ir a pagarlo', () => {
      const { html } = orderReceived(conTienda);

      expect(html).toContain('https://www.maxihabana.com/pedidos/abc-123');
      expect(html).toContain('Pagar mi pedido');
    });

    it('sin enlace al pedido no pinta un botón roto', () => {
      const { html } = orderReceived({ ...conTienda, orderUrl: null });

      expect(html).not.toContain('Pagar mi pedido');
      expect(html).not.toContain('href="null');
    });

    it('avisa de que la reserva caduca, que es lo que pierde pedidos', () => {
      const { html } = orderReceived(conTienda);

      expect(html).toContain('se cancela');
    });

    it('no dice que esté pagado ni promete fecha de entrega', () => {
      const { html, subject } = orderReceived(conTienda);

      expect(`${subject} ${html}`).not.toMatch(/pago recibido|ya está pagado/i);
      expect(html).not.toMatch(/te lo entregamos el|fecha de entrega/i);
    });

    it('en texto plano la tabla no sale pegada', () => {
      // Antes: «PedidoORD-20260001Se recoge en…», todo junto, porque al quitar
      // las etiquetas no quedaba nada entre celda y celda.
      const { text } = orderReceived(conTienda);

      expect(text).toContain('Pedido: ORD-20260001');
      expect(text).not.toContain('PedidoORD-20260001');
    });

    it('la versión de texto empieza por el título, no a media frase', () => {
      const { text } = orderReceived(conTienda);

      expect(text.startsWith('¡Listo! Tenemos tu pedido')).toBe(true);
    });

    it('tutea', () => {
      const { html } = orderReceived(conTienda);

      expect(html).not.toMatch(/\btenés\b|\bpodés\b|\bpagá\b/);
      expect(html).toContain('tu pedido');
    });
  });

  describe('el pie y la marca, iguales en todos', () => {
    // Antes solo la bienvenida llevaba enlaces legales: las otras siete salían
    // sin política de privacidad ni términos, que es de lo primero que mira un
    // filtro de spam.
    const conEnlaces = (html: string) =>
      [
        'politica-de-privacidad',
        'terminos-y-condiciones',
        'preguntas-frecuentes',
      ].every((enlace) => html.includes(enlace));

    const conTienda: OrderMailData = {
      ...order,
      storeUrl: 'https://www.maxihabana.com',
    };

    it('todos los correos de pedido llevan los enlaces legales', () => {
      expect(conEnlaces(orderReceived(conTienda).html)).toBe(true);
      expect(conEnlaces(paymentReceived(conTienda).html)).toBe(true);
      expect(conEnlaces(orderShipped(conTienda).html)).toBe(true);
      expect(conEnlaces(orderDelivered(conTienda).html)).toBe(true);
      expect(conEnlaces(orderCancelled(conTienda, null).html)).toBe(true);
    });

    it('sin URL de tienda no inventa enlaces rotos', () => {
      const sinTienda = paymentReceived({ ...order, storeUrl: null });
      expect(sinTienda.html).not.toContain('href="/');
      expect(sinTienda.html).not.toContain('null/');
    });

    it('la marca va en texto, porque Gmail bloquea las imágenes', () => {
      const html = paymentReceived(order).html;
      expect(html).toContain('Habana');
      expect(html).not.toContain('<img');
    });

    it('dice por qué le llega el correo a quien lo recibe', () => {
      expect(paymentReceived(order).html).toMatch(/Recibes este correo porque/);
      expect(orderShipped(order).html).toMatch(/Recibes este correo porque/);
    });
  });
  describe('redes sociales en el pie', () => {
    it('las ocho plantillas llevan Facebook e Instagram', () => {
      for (const html of [
        paymentReceived(order).html,
        orderShipped(order).html,
        orderDelivered(order).html,
        orderCancelled(order, null).html,
        welcome({
          customerName: 'Marisol',
          storeUrl: 'https://www.maxihabana.com',
          whatsapp: '+53 5251 9414',
        }).html,
      ]) {
        expect(html).toContain('facebook.com');
        expect(html).toContain('instagram.com');
      }
    });

    // El de Instagram venía con un `?stkn=` que es un token de la sesión de
    // quien copió el enlace: publicarlo sería filtrar algo de su cuenta.
    it('el enlace de Instagram no lleva tokens de sesión', () => {
      expect(paymentReceived(order).html).not.toContain('stkn=');
    });
  });
  // La tienda vende en USD y hay pedidos de cinco cifras: sin separador hay
  // que contar los dígitos para saber si son cinco mil o cincuenta mil, y el
  // correo del pago es donde menos se quiere dudar.
  it('los importes llevan separador de miles', () => {
    const caro = paymentReceived({ ...order, total: '51840.00' });
    expect(caro.text).toContain('$51,840.00');
    expect(caro.text).not.toContain('$51840.00');
  });

  it('un importe pequeño no gana comas de más', () => {
    const barato = paymentReceived({ ...order, total: '60.00' });
    expect(barato.text).toContain('$60.00');
  });
});
