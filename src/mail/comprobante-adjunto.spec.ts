import { CmsService } from '../cms/cms.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderPdfService } from '../orders/order-pdf.service';
import { Order } from '../orders/entities/order.entity';
import { EmailStatus } from './entities/email-log.entity';
import { MailService } from './mail.service';
import { OrderMailerService } from './order-mailer.service';

/**
 * MxH-0051: al confirmarse el pago, el cliente recibe su pedido en papel.
 *
 * El documento es el comprobante, no una factura fiscal —eso es MxH-0057, que
 * Jade tiene parada—, y el propio PDF lo dice impreso.
 *
 * Lo que más importa de estas pruebas es la última: un fallo al componer el
 * PDF no puede quedarse con el aviso. Que el cliente sepa que su pago entró
 * vale más que el adjunto.
 */
describe('MxH-0051 · el correo de pago lleva el comprobante', () => {
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
    pdf = {
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
    };
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

  it('adjunta el comprobante, con el número del pedido en el nombre', async () => {
    await service.paymentReceived('ord-1');

    const enviado = mail.send.mock.calls[0][0];
    expect(enviado.attachments).toHaveLength(1);
    expect(enviado.attachments[0].filename).toBe('pedido-ORD-20260199.pdf');
    expect(enviado.attachments[0].content).toBeInstanceOf(Buffer);
  });

  it('los demás avisos no llevan adjunto', async () => {
    // Solo el de pago. Mandar el comprobante en cada cambio de estado sería
    // repetir el mismo papel cuatro veces.
    await service.shipped('ord-1');
    expect(mail.send.mock.calls[0][0].attachments).toBeUndefined();
  });

  it('si el PDF falla, el aviso sale igual y sin adjunto', async () => {
    pdf.generate.mockRejectedValue(new Error('se cayó el generador'));

    const r = await service.paymentReceived('ord-1');

    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0].attachments).toBeUndefined();
    expect(r?.status).toBe(EmailStatus.SENT);
  });
});
