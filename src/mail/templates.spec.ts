import {
  OrderMailData,
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
});
