import { OrderMailData, paymentReceived, refundCompleted } from './templates';

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
});
