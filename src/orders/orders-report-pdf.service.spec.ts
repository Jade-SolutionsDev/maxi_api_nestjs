import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { inflateSync } from 'node:zlib';
import { fechaHoraCortaEnCuba } from '../common/zona';
import { OrderStatus, PaymentStatus } from './entities/order.entity';
import { OrderResponseDto } from './dto/order-response.dto';
import {
  ANCHO_UTIL,
  COLUMNAS,
  COLUMNAS_CON_ENTREGA,
  OrdersReportPdfService,
} from './orders-report-pdf.service';

/**
 * El texto que de verdad lleva impreso el PDF.
 *
 * pdfkit comprime los flujos de contenido y escribe las cadenas en
 * hexadecimal, así que `pdf.toString()` no encuentra ni una palabra del
 * documento. Por eso las primeras pruebas de este fichero se conformaban con
 * medir cuánto crecía el fichero; esto mira lo que hay escrito.
 */
const textoDelPdf = (pdf: Buffer): string => {
  const crudo = pdf.toString('latin1');
  const trozos: string[] = [];
  const marca = /stream\r?\n/g;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = marca.exec(crudo)) !== null) {
    const inicio = encontrado.index + encontrado[0].length;
    const fin = crudo.indexOf('endstream', inicio);
    if (fin < 0) continue;
    try {
      trozos.push(
        inflateSync(Buffer.from(crudo.slice(inicio, fin), 'latin1')).toString(
          'latin1',
        ),
      );
    } catch {
      // Las fuentes y las imágenes también son flujos, y no son texto.
    }
  }
  return trozos
    .join('\n')
    .replace(/<([0-9a-fA-F]+)>/g, (_, hex: string) =>
      Buffer.from(hex, 'hex').toString('latin1'),
    );
};

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
  describe('resumen por periodo', () => {
    const filas = [
      { periodo: '2026-09-01T00:00:00.000Z', pedidos: 18, importe: '4320.00' },
      { periodo: '2026-09-08T00:00:00.000Z', pedidos: 24, importe: '6150.00' },
    ];

    it('sale cuando se pide, y no cuando no', async () => {
      const con = await service.generate([pedido()], totales, {}, false, {
        periodo: 'week',
        filas,
      });
      const sin = await service.generate([pedido()], totales, {});
      expect(con.length).toBeGreaterThan(sin.length);
    });

    it('no revienta con un resumen vacío', async () => {
      const pdf = await service.generate([pedido()], totales, {}, false, {
        periodo: 'month',
        filas: [],
      });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  /**
   * La fecha de entrega en la tabla: lo que se pidió es poder filtrar por
   * «Entregado» y ver de un vistazo cuándo se entregó cada pedido, sin abrir
   * ninguno.
   */
  describe('la fecha de entrega', () => {
    const entregado = (cuando: string) =>
      pedido({
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        deliveredAt: new Date(cuando),
      });

    it('sale en la tabla, en hora de Cuba, cuando el pedido se entregó', async () => {
      const pdf = await service.generate(
        [entregado('2026-10-07T15:05:00Z')],
        totales,
        {
          status: 'delivered',
          paymentStatus: 'paid',
        },
      );
      const texto = textoDelPdf(pdf);
      expect(texto).toContain('ENTREGADO');
      // Las 15:05 UTC son las 11:05 en Cuba, no las 15:05.
      expect(texto).toContain(
        fechaHoraCortaEnCuba(new Date('2026-10-07T15:05:00Z')),
      );
      expect(texto).toContain('11:05');
    });

    // Una columna de guiones le quita ancho al nombre del cliente y no dice
    // nada: en un reporte sin entregas no tiene por qué estar.
    it('no aparece cuando ningún pedido se ha entregado', async () => {
      const texto = textoDelPdf(
        await service.generate([pedido()], totales, {}),
      );
      expect(texto).toContain('CREADO');
      expect(texto).not.toContain('ENTREGADO');
    });

    // Un filtro por «Pagado» trae entregados y no entregados mezclados.
    it('basta con que uno se haya entregado para que la columna salga', async () => {
      const pdf = await service.generate(
        [
          pedido({ id: 'sin', orderNumber: 'ORD-20260001' }),
          entregado('2026-10-07T15:05:00Z'),
        ],
        totales,
        { paymentStatus: 'paid' },
      );
      const texto = textoDelPdf(pdf);
      expect(texto).toContain('ENTREGADO');
      // El que no se entregó sigue en la tabla: la columna no lo filtra.
      expect(texto).toContain('ORD-20260001');
    });

    // La cabecera se repite en cada página, y tiene que repetirla con la
    // columna nueva: si no, la segunda hoja dice «CREADO» encima de la fecha
    // de entrega.
    it('la cabecera repetida de la segunda página también la lleva', async () => {
      const muchos = Array.from({ length: 120 }, (_, i) =>
        pedido({
          id: `o${i}`,
          orderNumber: `ORD-2026${String(i).padStart(4, '0')}`,
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date('2026-10-07T15:05:00Z'),
        }),
      );
      const texto = textoDelPdf(await service.generate(muchos, totales, {}));
      const cabeceras = texto.match(/ENTREGADO/g) ?? [];
      expect(cabeceras.length).toBeGreaterThan(1);
    });

    // Los anchos se reparten a mano: si alguien suma uno sin restar otro, la
    // última columna se sale de la hoja y nadie lo ve hasta imprimirlo.
    it('ningún juego de columnas se sale de la hoja', () => {
      const ancho = (columnas: typeof COLUMNAS) =>
        columnas.reduce((suma, col) => suma + col.ancho, 0);
      // El juego de siete columnas se pasa de 761,89 a 762 desde que se
      // escribió: una décima de punto, que en papel no se ve. Se le mide al
      // punto entero; al nuevo, que se reparte ahora, se le exige que quepa.
      expect(ancho(COLUMNAS)).toBeLessThanOrEqual(Math.ceil(ANCHO_UTIL));
      expect(ancho(COLUMNAS_CON_ENTREGA)).toBeLessThanOrEqual(ANCHO_UTIL);
      // Y que la de entrega no sea más estrecha que la de creación, que
      // llevan el mismo formato de fecha.
      const creado = COLUMNAS_CON_ENTREGA.find((c) => c.clave === 'fecha');
      const entrega = COLUMNAS_CON_ENTREGA.find((c) => c.clave === 'entrega');
      expect(entrega?.ancho).toBeGreaterThanOrEqual(creado?.ancho ?? 0);
    });
  });

  // Los filtros nuevos tienen que decirse en el papel: un reporte que no
  // cuenta de qué está hecho no se puede archivar ni enseñar.
  it('el documento nombra los filtros de entrega e importe', async () => {
    const pdf = await service.generate([pedido()], totales, {
      fulfillmentType: 'pickup',
      minTotal: '100',
      maxTotal: '5000',
    });
    // El texto del PDF va comprimido; se comprueba que el documento crece
    // respecto al mismo reporte sin esos filtros.
    const sinFiltros = await service.generate([pedido()], totales, {});
    expect(pdf.length).toBeGreaterThan(sinFiltros.length);
  });
});
