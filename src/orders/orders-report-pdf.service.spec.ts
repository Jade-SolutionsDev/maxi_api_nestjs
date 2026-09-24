import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, PaymentStatus } from './entities/order.entity';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersReportPdfService } from './orders-report-pdf.service';

describe('OrdersReportPdfService', () => {
  let service: OrdersReportPdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersReportPdfService,
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
      ],
    }).compile();
    service = module.get(OrdersReportPdfService);
  });

  const pedido = (extra: Partial<OrderResponseDto> = {}): OrderResponseDto =>
    ({
      id: 'o1',
      orderNumber: 'ORD-20260175',
      clientName: 'Johel Vargas',
      clientEmail: 'punto4397@gmail.com',
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.PENDING,
      total: '305.00',
      createdAt: new Date('2026-09-24T15:06:07Z'),
      paymentMethod: { code: 'tropipay', label: 'Tarjeta (Tropipay)' },
      ...extra,
    }) as OrderResponseDto;

  const totales = [
    { estado: 'cancelled', pedidos: 47, importe: '12480.00' },
    { estado: 'confirmed', pedidos: 12, importe: '56195.00' },
  ];

  it('devuelve un PDF de verdad', async () => {
    const pdf = await service.generate([pedido()], totales, {});
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('sale igual cuando ningún pedido cumple el filtro', async () => {
    const pdf = await service.generate([], [], { status: 'delivered' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  describe('el nombre del fichero dice qué contiene', () => {
    it('lleva el rango y el estado', () => {
      expect(
        service.nombreDelFichero({
          from: '2026-09-01',
          to: '2026-09-24',
          status: 'cancelled',
        }),
      ).toBe('pedidos-2026-09-01-2026-09-24-cancelado.pdf');
    });

    it('sin filtros no inventa un rango', () => {
      expect(service.nombreDelFichero({})).toBe('pedidos.pdf');
    });

    // Un nombre con tildes o espacios se rompe al descargarlo en según qué
    // navegador y acaba llamándose «pedidos-cancelado%20.pdf».
    it('no deja tildes ni caracteres raros', () => {
      const nombre = service.nombreDelFichero({
        status: 'processing',
        paymentStatus: 'refunded',
      });
      expect(nombre).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(nombre).toContain('proceso');
    });
  });

  // Con muchos pedidos el documento pasa de una página, y una hoja suelta
  // tiene que seguir diciendo de quién es y qué filtro la produjo.
  it('crece a varias páginas sin romperse', async () => {
    const muchos = Array.from({ length: 120 }, (_, i) =>
      pedido({
        id: `o${i}`,
        orderNumber: `ORD-2026${String(i).padStart(4, '0')}`,
      }),
    );
    const pdf = await service.generate(muchos, totales, {
      from: '2026-09-01',
      to: '2026-09-24',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Cada página es un objeto /Type /Page en el documento.
    const paginas = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(paginas.length).toBeGreaterThan(1);
  });
});
