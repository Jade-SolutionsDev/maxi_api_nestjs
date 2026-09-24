import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { OrderPdfService } from './order-pdf.service';
import { OrdersReportPdfService } from './orders-report-pdf.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderStatus } from './entities/order.entity';

describe('OrdersController · descarga del comprobante', () => {
  let controller: OrdersController;
  let pdfService: {
    findOrderOrFail: jest.Mock;
    generate: jest.Mock;
    fileNameFor: jest.Mock;
  };
  let reportePdf: { generate: jest.Mock; nombreDelFichero: jest.Mock };
  let res: { set: jest.Mock };

  beforeEach(async () => {
    pdfService = {
      findOrderOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-20260148' }),
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 contenido')),
      fileNameFor: jest.fn().mockReturnValue('ORD-20260148.pdf'),
    };
    reportePdf = {
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 reporte')),
      nombreDelFichero: jest.fn().mockReturnValue('pedidos.pdf'),
    };
    res = { set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: {} },
        { provide: OrderPdfService, useValue: pdfService },
        { provide: OrdersReportPdfService, useValue: reportePdf },
      ],
    })
      .overrideGuard(class {})
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrdersController);
  });

  it('devuelve el archivo y lo nombra como el pedido', async () => {
    const salida = await controller.pdf('o-1', res as unknown as Response);

    expect(salida).toBeInstanceOf(StreamableFile);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ORD-20260148.pdf"',
      }),
    );
  });

  it('comprueba que el pedido existe antes de componer nada', async () => {
    await controller.pdf('o-1', res as unknown as Response);

    expect(pdfService.findOrderOrFail).toHaveBeenCalledWith('o-1');
  });
});
describe('OrdersController · reporte de pedidos', () => {
  let controller: OrdersController;
  let ordersService: {
    findAllForReport: jest.Mock;
    totalesForReport: jest.Mock;
  };
  let reportePdf: { generate: jest.Mock; nombreDelFichero: jest.Mock };
  let res: { set: jest.Mock };

  beforeEach(async () => {
    ordersService = {
      findAllForReport: jest
        .fn()
        .mockResolvedValue({ pedidos: [], total: 0, recortado: false }),
      totalesForReport: jest.fn().mockResolvedValue([]),
      resumenPorPeriodo: jest.fn().mockResolvedValue([]),
    };
    reportePdf = {
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 reporte')),
      nombreDelFichero: jest.fn().mockReturnValue('pedidos-cancelado.pdf'),
    };
    res = { set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: OrderPdfService, useValue: {} },
        { provide: OrdersReportPdfService, useValue: reportePdf },
      ],
    })
      .overrideGuard(class {})
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrdersController);
  });

  // Lo que se ve en pantalla es lo que sale: los filtros llegan tal cual al
  // servicio, sin que el controlador invente ni recorte ninguno.
  it('pasa los filtros de la pantalla a la consulta del reporte', async () => {
    const filtros = {
      status: OrderStatus.CANCELLED,
      from: '2026-09-01',
      to: '2026-09-24',
    };

    await controller.reportePdf(filtros, undefined, res as unknown as Response);

    expect(ordersService.findAllForReport).toHaveBeenCalledWith(filtros);
    expect(ordersService.totalesForReport).toHaveBeenCalledWith(filtros);
  });

  it('devuelve el PDF con un nombre que dice qué contiene', async () => {
    const archivo = await controller.reportePdf(
      { status: OrderStatus.CANCELLED },
      undefined,
      res as unknown as Response,
    );

    expect(archivo).toBeInstanceOf(StreamableFile);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="pedidos-cancelado.pdf"',
      }),
    );
  });
  // El resumen es opcional: sin `groupBy` no se pide, para no gastar una
  // consulta de agregación en un reporte que no lo lleva.
  it('sin agrupación no consulta el resumen', async () => {
    await controller.reportePdf({}, undefined, res as unknown as Response);
    expect(ordersService.resumenPorPeriodo).not.toHaveBeenCalled();
  });

  it('con agrupación pide el resumen de ese periodo', async () => {
    await controller.reportePdf({}, 'week', res as unknown as Response);
    expect(ordersService.resumenPorPeriodo).toHaveBeenCalledWith({}, 'week');
  });

  // Un `groupBy` inventado no puede colarse en el SQL del `date_trunc`.
  it('ignora una agrupación que no reconoce', async () => {
    await controller.reportePdf(
      {},
      'año; DROP TABLE orders' as never,
      res as unknown as Response,
    );
    expect(ordersService.resumenPorPeriodo).not.toHaveBeenCalled();
  });
});
