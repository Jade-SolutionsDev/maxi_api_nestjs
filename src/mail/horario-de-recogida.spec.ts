import {
  orderReceived,
  paymentReceived,
  pickupReminder,
  type OrderMailData,
} from './templates';

/**
 * MxH-0160: el horario del mostrador sale en los correos de recogida.
 *
 * No existía en ninguna parte del sistema: vivía dentro del texto libre de la
 * ficha de la balita, y esa ficha hoy ni se sirve. Tres clientes preguntaron por
 * correo en septiembre cuándo podían pasar, y a dos se les respondió con
 * evasivas porque el dato no estaba en ningún sitio localizable.
 */
const HORARIO = '9:00 am a 3:00 pm, de lunes a viernes';

const pedido = (overrides: Partial<OrderMailData> = {}): OrderMailData => ({
  orderNumber: 'ORD-20260042',
  customerName: 'Merly',
  total: '60.00',
  currency: 'USD',
  pickupAddress: 'Maxi Cárdenas · Mostrador · Calle 23 Esq. 43',
  pickupHours: HORARIO,
  whatsapp: '+53 5251 9414',
  storeUrl: 'https://maxihabana.com',
  orderUrl: null,
  trackingUrl: null,
  ...overrides,
});

describe('MxH-0160 · el horario del mostrador en los correos', () => {
  it('sale en el aviso de pedido recibido', () => {
    const { html, text } = paymentReceived(pedido());
    expect(html).toContain('Horario');
    expect(html).toContain(HORARIO);
    // Y en la versión en texto plano, que es la que leen algunos clientes.
    expect(text).toContain(HORARIO);
  });

  it('sale también antes de pagar', () => {
    expect(orderReceived(pedido()).html).toContain(HORARIO);
  });

  it('y en el recordatorio, que es cuando el cliente lo busca', () => {
    const { html } = pickupReminder(pedido(), 15);
    expect(html).toContain('Horario');
    expect(html).toContain(HORARIO);
  });

  describe('sin horario publicado', () => {
    it('no deja un hueco ni un guion', () => {
      const { html } = paymentReceived(pedido({ pickupHours: null }));
      expect(html).not.toContain('Horario');
      // La dirección sigue saliendo: lo que falta es el horario, no el bloque.
      expect(html).toContain('Calle 23 Esq. 43');
    });

    it('tampoco en el recordatorio', () => {
      const { html } = pickupReminder(pedido({ pickupHours: null }), 15);
      expect(html).not.toContain('Horario');
      expect(html).toContain('Dónde recogerlo');
    });

    it('ni en un pedido anterior a esta tarjeta, que no trae el campo', () => {
      const { pickupHours: _fuera, ...viejo } = pedido();
      expect(paymentReceived(viejo as OrderMailData).html).not.toContain(
        'Horario',
      );
    });
  });

  it('no promete horario en una entrega a domicilio', () => {
    // Sin mostrador no hay nada que recoger: el horario ahí solo confunde.
    const { html } = paymentReceived(
      pedido({ pickupAddress: null, pickupHours: HORARIO }),
    );
    expect(html).not.toContain('Horario');
  });
});
