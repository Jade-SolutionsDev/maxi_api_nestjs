import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { OrderPdfService } from './order-pdf.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController · descarga del comprobante', () => {
  let controller: OrdersController;
  let pdfService: {
    findOrderOrFail: jest.Mock;
    generate: jest.Mock;
    fileNameFor: jest.Mock;
  };
  let res: { set: jest.Mock };

  beforeEach(async () => {
    pdfService = {
      findOrderOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-20260148' }),
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 contenido')),
      fileNameFor: jest.fn().mockReturnValue('ORD-20260148.pdf'),
    };
    res = { set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: {} },
        { provide: OrderPdfService, useValue: pdfService },
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
