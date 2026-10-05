import { CmsService } from '../cms/cms.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderPdfService } from '../orders/order-pdf.service';
import { EmailStatus } from './entities/email-log.entity';
import { MailService } from './mail.service';
import { OrderMailerService } from './order-mailer.service';

/**
 * El aviso de pago sale aunque el comprobante falle —se decidió en MxH-0051 y
 * sigue siendo lo correcto: el cliente necesita saber que su pago entró, y el
 * papel lo puede descargar después—.
 *
 * Pero esa decisión solo se sostiene si el fallo se puede ver, y no se veía: el
 * `logger.error` va al stdout del contenedor, que hoy no llega a Loki
 * (MxH-0123), y en `email_log` el correo quedaba como `sent`, idéntico a los
 * que sí llevaron papel. Si la plantilla del PDF se rompe para todos, nadie se
 * entera hasta que un cliente lo dice.
 *
 * Por eso el envío viaja con una `nota`, que `MailService` guarda en el
 * registro cuando no hubo error de envío: así se cuenta con una consulta.
 */
describe('un aviso de pago sin comprobante deja constancia', () => {
  const pedido = {
    id: 'ord-1',
    orderNumber: 'ORD-20260199',
    total: '60.00',
    client: { email: 'cliente@ejemplo.com', firstName: 'Merly' },
    items: [],
  } as unknown as Order;

  let service: OrderMailerService;
  let mail: { send: jest.Mock };
  let pdf: { generate: jest.Mock };

  beforeEach(async () => {
    mail = { send: jest.fn().mockResolvedValue({ status: EmailStatus.SENT }) };
    pdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    const module = await Test.createTestingModule({
      providers: [
        OrderMailerService,
        {
          // Las redes del pie salen de los ajustes del sitio (MxH-0119).
          provide: CmsService,
          useValue: {
            getSettings: jest.fn().mockResolvedValue({ social: [] }),
          },
        },
        { provide: MailService, useValue: mail },
        {
          provide: getRepositoryToken(Order),
          useValue: { findOne: jest.fn().mockResolvedValue(pedido) },
        },
        { provide: OrderPdfService, useValue: pdf },
        {
          provide: ConfigService,
          useValue: {
            get: (c: string) =>
              ({
                storefront: { url: 'https://maxihabana.com' },
                support: { whatsapp: '+53 5251 9414' },
              })[c],
          },
        },
      ],
    }).compile();
    service = module.get(OrderMailerService);
  });

  it('manda la nota que explica por qué va sin papel', async () => {
    pdf.generate.mockRejectedValue(new Error('se cayó el generador'));

    await service.paymentReceived('ord-1');

    const enviado = mail.send.mock.calls[0][0];
    expect(enviado.attachments).toBeUndefined();
    expect(enviado.nota).toMatch(/sin comprobante/i);
    // Y dice el motivo, que es lo que permite arreglarlo sin adivinar.
    expect(enviado.nota).toContain('se cayó el generador');
  });

  it('cuando el comprobante va, no manda nota ninguna', async () => {
    await service.paymentReceived('ord-1');

    const enviado = mail.send.mock.calls[0][0];
    expect(enviado.attachments).toHaveLength(1);
    expect(enviado.nota).toBeUndefined();
  });
});
