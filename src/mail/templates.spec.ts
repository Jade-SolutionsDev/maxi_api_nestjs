import {
  OrderMailData,
  orderCancelled,
  orderDelivered,
  orderShipped,
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
      expect(rendered.text).toContain('Hola, Marisol:');
      expect(rendered.subject).toContain('Marisol');
    });

    it('sin nombre el saludo sigue teniendo sentido', () => {
      const rendered = welcome({ ...datos, customerName: null });
      expect(rendered.text).toContain('Hola:');
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
      expect(r.text).toMatch(/dinero se te devuelve/i);
      expect(r.text).toContain('$60.00');
      expect(r.text).not.toContain('No se te cobró nada');
    });
  });

  it('los tres avisos de estado llevan el número de pedido en el asunto', () => {
    expect(orderShipped(order).subject).toContain('ORD-20260001');
    expect(orderDelivered(order).subject).toContain('ORD-20260001');
    expect(orderCancelled(order, null).subject).toContain('ORD-20260001');
  });
});
