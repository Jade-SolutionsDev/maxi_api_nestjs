import {
  OrderMailData,
  orderCancelled,
  orderDelivered,
  orderReceived,
  orderShipped,
  paymentReceived,
  pickupReminder,
  clientInvitation,
} from './templates';

/**
 * MxH-0050: Merly pidió que los correos lleven al cliente a su pedido. Hasta
 * ahora solo el primero —el de «falta pagar»— tenía botón; los cinco que llegan
 * después dejaban al cliente sin forma de llegar, incluido el de «te espera en
 * el mostrador», que es el que más se abre.
 *
 * El enlace que se pone es el de SEGUIMIENTO, no el de la ficha en la cuenta.
 * El de la cuenta exige iniciar sesión, y un correo que pide contraseña es
 * donde se pierde a la mitad de la gente. El de seguimiento es público y no
 * enseña ni correo, ni teléfono, ni dirección, ni importes, ni productos.
 */
const base: OrderMailData = {
  orderNumber: 'ORD-20260001',
  customerName: 'Eduardo Rodríguez',
  total: '60.00',
  currency: 'USD',
  pickupAddress: 'Calle 23 esq. 43, Cárdenas',
  whatsapp: '+53 5251 9414',
  storeUrl: 'https://maxihabana.com',
  orderUrl: 'https://maxihabana.com/pedidos/abc',
  trackingUrl: 'https://maxihabana.com/seguimiento/t0k3n',
};

const informativos: Array<
  [string, (o: OrderMailData) => { html: string; text: string }]
> = [
  ['pago recibido', paymentReceived],
  ['te espera en el mostrador', (o) => pickupReminder(o, 3)],
  ['va en camino', orderShipped],
  ['entregado', orderDelivered],
  ['cancelado', (o) => orderCancelled(o, null)],
];

describe('MxH-0050 · los correos llevan al pedido', () => {
  it.each(informativos)(
    '«%s» lleva el enlace de seguimiento',
    (_n, plantilla) => {
      const { html, text } = plantilla(base);
      expect(html).toContain(base.trackingUrl);
      // También en la versión de texto plano: hay quien lee el correo así.
      expect(text).toContain(base.trackingUrl);
    },
  );

  it.each(informativos)(
    '«%s» no enlaza a la ficha que pide contraseña',
    (_n, plantilla) => {
      expect(plantilla(base).html).not.toContain('/pedidos/abc');
    },
  );

  it.each(informativos)(
    '«%s» aguanta un pedido sin enlace',
    (_n, plantilla) => {
      // Sin STOREFRONT_URL configurada no hay enlace; el correo sale igual.
      const { html } = plantilla({ ...base, trackingUrl: null });
      expect(html).not.toContain('seguimiento');
      expect(html).toContain('ORD-20260001');
    },
  );

  it('el primero sigue llevando a pagar, que es donde la sesión se justifica', () => {
    const { html } = orderReceived(base);
    expect(html).toContain(base.orderUrl);
    expect(html).toContain('Pagar mi pedido');
  });
});

describe('la invitación no repite la dirección en texto plano', () => {
  it('en HTML mantiene el respaldo copiable; en texto, no', () => {
    const { html, text } = clientInvitation({
      customerName: 'Merly',
      invitationUrl: 'https://maxihabana.com/invitacion/TOKEN123',
      storeUrl: 'https://maxihabana.com',
      whatsapp: '+53 5251 9414',
    });

    // En HTML el respaldo tiene sentido: el botón arriba y la dirección
    // copiable debajo, para quien no pueda pulsar.
    expect(html).toContain('Si el botón no te funciona');

    // En texto plano no hay botón que pulsar, así que la frase no significa
    // nada y la dirección saldría dos veces seguidas.
    expect(text).not.toContain('Si el botón no te funciona');
    expect(text.match(/TOKEN123/g)).toHaveLength(1);
  });
});
