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
  let mail: { send: jest.Mock; configured: boolean };
  let orderRepo: { findOne: jest.Mock };
  let config: Record<string, unknown>;

  beforeEach(async () => {
    mail = { send: jest.fn().mockResolvedValue(null), configured: true };
    orderRepo = { findOne: jest.fn().mockResolvedValue(pedido) };
    config = {
      support: { whatsapp: '+53 5251 9414' },
      storefront: { url: TIENDA },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderMailerService,
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
});
