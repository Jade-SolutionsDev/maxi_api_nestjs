import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CmsService } from '../cms/cms.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { lineasDeEntrega, OrderPdfService } from './order-pdf.service';

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
      client: {
        firstName: 'Johel',
        lastName: 'Vargas',
        email: 'j@example.com',
      },
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
          legalLinks: [{ label: 'Privacidad', slug: 'politica-de-privacidad' }],
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
            get: jest
              .fn()
              .mockImplementation((clave: string) =>
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
        contactSnapshot: {
          recipientName: 'Ana Pérez',
          idCard: '85042312345',
          contactPhone: '+53 5251 9414',
        },
      } as Partial<Order>),
    );

    const pdf = await service.generate('o-1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('lineasDeEntrega', () => {
  it('en recogida dice quién retira, con su carnet y su teléfono', () => {
    const lineas = lineasDeEntrega({
      fulfillmentType: 'pickup',
      pickupAddressSnapshot: {
        locationName: 'Mostrador Cárdenas',
        address: 'Calle 23 esq. 43',
      },
      contactSnapshot: {
        recipientName: 'Ana Pérez',
        idCard: '85042312345',
        contactPhone: '+53 5251 9414',
      },
    } as unknown as Order);

    expect(lineas).toContain('Recoge: Ana Pérez (85042312345)');
    expect(lineas).toContain('Teléfono: +53 5251 9414');
  });

  it('en entrega dice a quién se entrega y en qué municipio', () => {
    const lineas = lineasDeEntrega({
      fulfillmentType: 'delivery',
      deliveryOptionLabel: 'Mensajería 24h',
      deliveryAddress: {
        street: 'Calle 12 #345',
        municipalityName: 'Cárdenas',
        provinceName: 'Matanzas',
      },
      contactSnapshot: {
        recipientName: 'Ana Pérez',
        contactPhone: '+53 5251 9414',
      },
    } as unknown as Order);

    expect(lineas).toContain('Recibe: Ana Pérez');
    expect(lineas).toContain('Cárdenas, Matanzas');
  });

  it('un pedido viejo sin destinatario no deja huecos con etiqueta', () => {
    const lineas = lineasDeEntrega({
      fulfillmentType: 'pickup',
      pickupAddressSnapshot: { locationName: 'Mostrador Cárdenas' },
      contactSnapshot: null,
    } as unknown as Order);

    expect(lineas.some((l) => l.startsWith('Recoge:'))).toBe(false);
    expect(lineas).toContain('Recogida en mostrador');
  });
});
