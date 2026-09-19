import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CmsService } from '../cms/cms.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderPdfService } from './order-pdf.service';

describe('OrderPdfService', () => {
  let service: OrderPdfService;
  let orderRepo: { findOne: jest.Mock };
  let itemRepo: { find: jest.Mock };
  let cms: { getSettings: jest.Mock };

  const pedido = (extra: Partial<Order> = {}) =>
    ({
      id: 'o-1',
      orderNumber: 'ORD-20260148',
      status: 'cancelled',
      paymentStatus: 'pending',
      subtotal: '51840.00',
      deliveryFee: '5.00',
      total: '51845.00',
      fulfillmentType: 'delivery',
      deliveryOptionLabel: 'Entrega a domicilio',
      deliveryAddress: { street: 'Calle 17', city: 'Plaza' },
      contactSnapshot: null,
      pickupAddressSnapshot: null,
      customerNotes: null,
      cancellationReason: null,
      paidAt: null,
      createdAt: new Date('2026-09-14T12:37:00Z'),
      client: { firstName: 'Johel', lastName: 'Vargas', email: 'j@example.com' },
      ...extra,
    }) as Order;

  beforeEach(async () => {
    orderRepo = { findOne: jest.fn().mockResolvedValue(pedido()) };
    itemRepo = {
      find: jest.fn().mockResolvedValue([
        {
          productNameSnapshot: 'Cerveza Cristal',
          quantity: 1,
          unitPrice: '51840.00',
          lineTotal: '51840.00',
        },
      ]),
    };
    cms = {
      getSettings: jest.fn().mockResolvedValue({
        contact: { email: 'hola@maxihabana.com', phone: '+53 5251 9414' },
        footer: {
          copyright: '© 2026 Maxi Habana',
          legalLinks: [
            { label: 'Privacidad', slug: 'politica-de-privacidad' },
          ],
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPdfService,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((clave: string) =>
              clave === 'storefront'
                ? { url: 'https://www.maxihabana.com' }
                : { whatsapp: '+53 5251 9414' },
            ),
          },
        },
        { provide: CmsService, useValue: cms },
      ],
    }).compile();
    service = module.get(OrderPdfService);
  });

  it('devuelve un PDF de verdad', async () => {
    const pdf = await service.generate('o-1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('el archivo se llama como el pedido', () => {
    expect(service.fileNameFor(pedido())).toBe('ORD-20260148.pdf');
  });

  it('un pedido que no existe no genera nada', async () => {
    orderRepo.findOne.mockResolvedValue(null);

    await expect(service.generate('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('si el CMS falla, el comprobante sale igual', async () => {
    cms.getSettings.mockRejectedValue(new Error('base caída'));

    const pdf = await service.generate('o-1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('cabe un pedido de recogida, con quien lo retira', async () => {
    orderRepo.findOne.mockResolvedValue(
      pedido({
        fulfillmentType: 'pickup',
        pickupAddressSnapshot: {
          locationName: 'Mostrador Cárdenas',
          address: 'Calle 23 esq. 43',
        },
        contactSnapshot: { fullName: 'Ana Pérez', idCard: '85042312345' },
      } as Partial<Order>),
    );

    const pdf = await service.generate('o-1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
