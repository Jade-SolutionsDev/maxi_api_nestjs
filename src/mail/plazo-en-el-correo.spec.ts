import { paymentReceived } from './templates';
import type { OrderMailData } from './templates';

/**
 * MxH-0147: el correo del pago dice cuándo estará listo el pedido.
 *
 * El plazo se cuenta en días hábiles desde que el pago se confirma
 * (`common/business-days.ts`), así que este correo es el primer sitio donde hay
 * una fecha que dar. Antes decía «listo para recoger» en el mismo minuto del
 * cobro, y eso manda a la gente al mostrador días antes de tiempo.
 */
const pedido = (promisedAt: OrderMailData['promisedAt']): OrderMailData => ({
  orderNumber: 'ORD-20260042',
  customerName: 'Merly',
  total: '60.00',
  currency: 'USD',
  pickupAddress: 'Maxi Centro · Mostrador · Calle 23 #456, Vedado',
  whatsapp: '+53 5251 9414',
  storeUrl: 'https://maxihabana.com',
  orderUrl: null,
  trackingUrl: null,
  promisedAt,
});

describe('MxH-0147 · el correo del pago dice cuándo estará listo', () => {
  it('pone la fecha comprometida con su día de la semana', () => {
    const { html, subject, text } = paymentReceived(
      pedido('2026-09-22T16:00:00Z'),
    );
    expect(html).toContain('martes 22 de septiembre');
    expect(subject).toBe(
      'Pedido ORD-20260042: pago recibido, listo el martes 22 de septiembre',
    );
    // La versión en texto plano no se queda sin el dato.
    expect(text).toContain('martes 22 de septiembre');
  });

  it('y entonces no dice que ya se puede recoger', () => {
    const { html, subject } = paymentReceived(pedido('2026-09-22T16:00:00Z'));
    expect(subject).not.toContain('listo para recoger');
    expect(html).not.toContain('Tu pedido está listo para recoger');
  });

  it('cuenta la custodia desde que esté listo, no desde hoy', () => {
    const { text } = paymentReceived(pedido('2026-09-22T16:00:00Z'));
    expect(text).toContain('30 días desde que esté listo');
    expect(text).not.toContain('30 días desde hoy');
  });

  it('la fecha es la de Cuba, no la de UTC', () => {
    // 01:30 UTC del 6 de octubre son las 21:30 del 5 en La Habana. Contar en
    // UTC adelantaría la fecha comprometida un día entero.
    const { html } = paymentReceived(pedido('2026-10-06T01:30:00Z'));
    expect(html).toContain('lunes 5 de octubre');
    expect(html).not.toContain('6 de octubre');
  });

  it('sin fecha comprometida, el correo sale exactamente como antes', () => {
    const sinPlazo = paymentReceived(pedido(null));
    expect(sinPlazo.subject).toBe(
      'Pedido ORD-20260042: pago recibido y listo para recoger',
    );
    expect(sinPlazo.html).toContain('Tu pedido está listo para recoger');
    expect(sinPlazo.html).toContain('30 días desde hoy');
    expect(sinPlazo.html).not.toContain('Listo el');
    // Un pedido anterior a MxH-0092 no trae el campo siquiera.
    const { promisedAt: _fuera, ...viejo } = pedido(null);
    expect(paymentReceived(viejo as OrderMailData).subject).toBe(
      sinPlazo.subject,
    );
  });
});
