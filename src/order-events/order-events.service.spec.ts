import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { User } from '../users/entities/user.entity';
import {
  OrderEvent,
  OrderEventActor,
  OrderEventKind,
} from './entities/order-event.entity';
import { OrderEventsService } from './order-events.service';

describe('OrderEventsService', () => {
  let service: OrderEventsService;
  let eventRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let consulta: Record<string, jest.Mock>;
  let userRepo: { find: jest.Mock };
  let clientRepo: { find: jest.Mock };

  beforeEach(async () => {
    consulta = {
      select: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    for (const metodo of Object.keys(consulta)) {
      if (metodo !== 'getRawMany') consulta[metodo].mockReturnValue(consulta);
    }
    eventRepo = {
      create: jest.fn().mockImplementation((o: unknown) => o),
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(consulta),
    };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    clientRepo = { find: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderEventsService,
        { provide: getRepositoryToken(OrderEvent), useValue: eventRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo },
      ],
    }).compile();
    service = module.get(OrderEventsService);
  });

  it('deduce el tipo de actor de quién actuó', async () => {
    await service.record(null, {
      orderId: 'o1',
      kind: OrderEventKind.STATUS_CHANGED,
      actor: { userId: 'u1' },
      field: 'status',
      previousValue: 'pending',
      nextValue: 'confirmed',
    });
    await service.record(null, {
      orderId: 'o1',
      kind: OrderEventKind.CREATED,
      actor: { clientId: 'c1' },
    });
    await service.record(null, {
      orderId: 'o1',
      kind: OrderEventKind.EXPIRED,
      actor: { system: true, reason: 'caducó' },
    });

    const rows = eventRepo.save.mock.calls.map((c) => c[0] as OrderEvent);
    expect(rows[0]).toMatchObject({
      actorKind: OrderEventActor.ADMIN,
      actorUserId: 'u1',
      actorClientId: null,
    });
    expect(rows[1]).toMatchObject({
      actorKind: OrderEventActor.CLIENT,
      actorClientId: 'c1',
      actorUserId: null,
    });
    expect(rows[2]).toMatchObject({
      actorKind: OrderEventActor.SYSTEM,
      reason: 'caducó',
    });
  });

  it('escribe con el manager de la transacción cuando se lo dan', async () => {
    const txRepo = {
      create: jest.fn().mockImplementation((o: unknown) => o),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(txRepo) };

    await service.record(manager as never, {
      orderId: 'o1',
      kind: OrderEventKind.REINSTATED,
      actor: { userId: 'u1' },
    });

    expect(manager.getRepository).toHaveBeenCalledWith(OrderEvent);
    expect(txRepo.save).toHaveBeenCalledTimes(1);
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('nunca tumba la operación principal si no puede guardar', async () => {
    eventRepo.save.mockRejectedValue(new Error('db down'));
    await expect(
      service.record(null, {
        orderId: 'o1',
        kind: OrderEventKind.CREATED,
        actor: { system: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('resuelve el nombre de quien actuó, admin o cliente', async () => {
    eventRepo.find.mockResolvedValue([
      {
        id: 'e1',
        orderId: 'o1',
        kind: OrderEventKind.STATUS_CHANGED,
        actorKind: OrderEventActor.ADMIN,
        actorUserId: 'u1',
        actorClientId: null,
        createdAt: new Date(),
      },
      {
        id: 'e2',
        orderId: 'o1',
        kind: OrderEventKind.CREATED,
        actorKind: OrderEventActor.CLIENT,
        actorUserId: null,
        actorClientId: 'c1',
        createdAt: new Date(),
      },
      {
        id: 'e3',
        orderId: 'o1',
        kind: OrderEventKind.EXPIRED,
        actorKind: OrderEventActor.SYSTEM,
        actorUserId: null,
        actorClientId: null,
        createdAt: new Date(),
      },
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'u1', firstName: 'Jose', lastName: 'Admin', email: 'j@x.com' },
    ]);
    clientRepo.find.mockResolvedValue([
      { id: 'c1', firstName: null, lastName: null, email: 'cliente@x.com' },
    ]);

    const list = await service.listForOrder('o1');

    expect(list.map((e) => e.actorName)).toEqual([
      'Jose Admin',
      'cliente@x.com',
      null,
    ]);
  });

  it('devuelve vacío sin consultar nombres cuando no hay eventos', async () => {
    expect(await service.listForOrder('o1')).toEqual([]);
    expect(userRepo.find).not.toHaveBeenCalled();
    expect(clientRepo.find).not.toHaveBeenCalled();
  });
  /**
   * MxH-0133, punto 3: de aquí sale el método de pago de los pedidos que se
   * cobraron sin pasar por ninguna pasarela.
   */
  describe('latestPaymentMethodsFor', () => {
    const condiciones = () =>
      [
        ...(consulta.where.mock.calls as [string, unknown][]),
        ...(consulta.andWhere.mock.calls as [string, unknown][]),
      ].map(([c]) => c);

    it('devuelve el método de cada pedido', async () => {
      consulta.getRawMany.mockResolvedValue([
        { orderId: 'o1', code: 'efectivo' },
        { orderId: 'o2', code: 'tropipay' },
      ]);

      const metodos = await service.latestPaymentMethodsFor(['o1', 'o2']);

      expect(metodos.get('o1')).toBe('efectivo');
      expect(metodos.get('o2')).toBe('tropipay');
    });

    // El evento `created` también lleva un `paymentMethod`: el que el cliente
    // eligió al encargar. Un pedido que nunca llegó a pagarse no se cobró con
    // nada, y decir que sí sería inventar un cobro.
    it('solo mira el cambio de estado de pago, no la creación', async () => {
      await service.latestPaymentMethodsFor(['o1']);

      const kind = (consulta.andWhere.mock.calls as [string, unknown][]).find(
        ([c]) => c.includes('event.kind'),
      );
      expect(kind?.[1]).toEqual({
        kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
      });
    });

    // Un método guardado como cadena vacía no es un método.
    it('descarta el método vacío', async () => {
      await service.latestPaymentMethodsFor(['o1']);

      expect(condiciones().some((c) => c.includes('nullif'))).toBe(true);
    });

    // Una consulta por pedido convertiría el listado en N+1: son hasta 5000
    // pedidos en el reporte.
    it('resuelve todos los pedidos en una sola consulta', async () => {
      await service.latestPaymentMethodsFor(['o1', 'o2', 'o3']);

      expect(eventRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      const dentro = (consulta.where.mock.calls as [string, unknown][])[0];
      expect(dentro[1]).toEqual({ orderIds: ['o1', 'o2', 'o3'] });
    });

    it('sin pedidos no consulta nada', async () => {
      const metodos = await service.latestPaymentMethodsFor([]);

      expect(metodos.size).toBe(0);
      expect(eventRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
