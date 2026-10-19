import { CmsService } from '../cms/cms.service';
import { OrderPdfService } from '../orders/order-pdf.service';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { MailService } from './mail.service';
import { OrderMailerService } from './order-mailer.service';

const TIENDA = 'https://www.maxihabana.com';

const pedido = {
  id: 'abc-123',
  orderNumber: 'ORD-20260001',
  total: '60.00',
  client: { email: 'cliente@ejemplo.com', firstName: 'Eduardo' },
  pickupAddressSnapshot: null,
  contactSnapshot: null,
} as unknown as Order;

describe('OrderMailerService', () => {
  let service: OrderMailerService;
  let mail: { send: jest.Mock; alreadySent: jest.Mock; configured: boolean };
  let orderRepo: { findOne: jest.Mock };
  let config: Record<string, unknown>;

  beforeEach(async () => {
    mail = {
      send: jest.fn().mockResolvedValue(null),
      alreadySent: jest.fn().mockResolvedValue(false),
      configured: true,
    };
    orderRepo = { findOne: jest.fn().mockResolvedValue(pedido) };
    config = {
      support: { whatsapp: '+53 5251 9414' },
      storefront: { url: TIENDA },
    };

    const module: TestingModule = await Test.createTestingModule({
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
          // Desde MxH-0051 el aviso de pago lleva el comprobante adjunto.
          provide: OrderPdfService,
          useValue: {
            generate: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
          },
        },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        {
          provide: ConfigService,
          useValue: { get: (clave: string) => config[clave] },
        },
      ],
    }).compile();

    service = module.get(OrderMailerService);
  });

  /**
   * `toMailData` tenía `storeUrl` fijo a `null`, así que el pie que el layout
   * sabe armar —privacidad, términos, preguntas frecuentes— no salía en ningún
   * correo del sistema. Se veía bien en las pruebas de las plantillas, porque
   * ahí la URL se pasa a mano.
   */
  it('los correos salen con los enlaces legales del pie', async () => {
    await service.orderReceived('abc-123');

    const { html } = mail.send.mock.calls[0][0];
    expect(html).toContain('politica-de-privacidad');
    expect(html).toContain('terminos-y-condiciones');
  });

  it('el correo de un pedido enlaza a ese pedido', async () => {
    await service.orderReceived('abc-123');

    const { html } = mail.send.mock.calls[0][0];
    expect(html).toContain(`${TIENDA}/pedidos/abc-123`);
  });

  it('sin URL de tienda configurada no inventa enlaces rotos', async () => {
    config.storefront = { url: undefined };

    await service.orderReceived('abc-123');

    const { html } = mail.send.mock.calls[0][0];
    expect(html).not.toContain('undefined/pedidos');
    expect(html).not.toContain('href="null');
  });

  it('un pedido que no existe no revienta ni manda nada', async () => {
    orderRepo.findOne.mockResolvedValue(null);

    await expect(service.orderReceived('fantasma')).resolves.toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sin dirección de correo del cliente no se manda', async () => {
    orderRepo.findOne.mockResolvedValue({
      ...pedido,
      client: null,
      contactSnapshot: null,
    });

    await expect(service.orderReceived('abc-123')).resolves.toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  /**
   * El aviso de caducidad por impago y la cancelación que hace un operario
   * comparten plantilla pero no son el mismo correo: se cuentan aparte y, en
   * producción, el primero está apagado y el segundo no. Si los dos se
   * registraran como `order_cancelled`, apagar uno apagaría los dos.
   */
  describe('la clave del registro distingue el motivo', () => {
    it('sin motivo registra order_cancelled', async () => {
      await service.cancelled('abc-123');
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'order_cancelled' }),
      );
    });

    it('por impago registra order_cancelled_payment_not_received', async () => {
      await service.cancelled('abc-123', 'payment_not_received');
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'order_cancelled_payment_not_received',
        }),
      );
    });
  });

  /**
   * El aviso del pedido nace en dos sitios con la misma plantilla y distinta
   * importancia, así que se registran aparte: en producción el de la tienda
   * está apagado por volumen (MxH-0121) y el del back-office no puede estarlo
   * —quien encarga por teléfono no tiene otra constancia de su pedido—.
   * Si algún día vuelven a compartir clave, apagar uno apaga el otro.
   */
  describe('el canal separa el aviso del pedido', () => {
    it('desde la tienda registra order_received', async () => {
      await service.orderReceived('abc-123');
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'order_received' }),
      );
    });

    it('desde el panel registra order_received_back_office', async () => {
      await service.orderReceived('abc-123', 'back-office');
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'order_received_back_office' }),
      );
    });

    it('sin canal se comporta como la tienda, que es el caso habitual', async () => {
      await service.orderReceived('abc-123');
      expect(mail.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ template: 'order_received_back_office' }),
      );
    });
  });

  /**
   * MxH-0052. Merly lo reportó el 1-oct: «el estado de En preparación no
   * envía correo». La tabla de la tarjeta lo pedía desde el principio.
   */
  describe('el pedido en preparación', () => {
    it('avisa con su propia plantilla y en el vocabulario del cliente', async () => {
      await service.processing('abc-123');

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'order_processing',
          orderId: 'abc-123',
          subject: 'Pedido ORD-20260001: en preparación',
        }),
      );
      const enviado = mail.send.mock.calls[0][0] as { html: string };
      expect(enviado.html).toContain('EN PREPARACIÓN');
      expect(enviado.html).not.toContain('processing');
    });

    it('no lleva el comprobante adjunto: ese es el del pago', async () => {
      await service.processing('abc-123');

      expect(mail.send).toHaveBeenCalledWith(
        expect.not.objectContaining({ attachments: expect.anything() }),
      );
    });
  });

  /**
   * «Un cambio de estado que se deshace y se rehace no manda el correo dos
   * veces», de los criterios de MxH-0052. El candado mira `email_log`, que es
   * lo único que sabe lo que esta persona ya recibió.
   */
  describe('cada aviso de estado sale una sola vez', () => {
    it.each([
      ['processing', 'order_processing'],
      ['shipped', 'order_shipped'],
      ['delivered', 'order_delivered'],
    ])('%s no se repite si ya se mandó', async (metodo, plantilla) => {
      mail.alreadySent.mockResolvedValue(true);

      const resultado = await (
        service as unknown as Record<string, (id: string) => Promise<unknown>>
      )[metodo]('abc-123');

      expect(mail.alreadySent).toHaveBeenCalledWith('abc-123', plantilla);
      expect(mail.send).not.toHaveBeenCalled();
      expect(resultado).toBeNull();
    });

    it('la cancelación distingue el motivo también en el candado', async () => {
      mail.alreadySent.mockResolvedValue(false);

      await service.cancelled('abc-123', 'payment_not_received');

      expect(mail.alreadySent).toHaveBeenCalledWith(
        'abc-123',
        'order_cancelled_payment_not_received',
      );
    });

    it('el aviso del pago no lleva candado: es el que no puede perderse', async () => {
      mail.alreadySent.mockResolvedValue(true);

      await service.paymentReceived('abc-123');

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'payment_received' }),
      );
    });
  });
});
