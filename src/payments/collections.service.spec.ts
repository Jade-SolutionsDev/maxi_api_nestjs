import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CollectionsService } from './collections.service';
import { Order } from '../orders/entities/order.entity';

describe('CollectionsService', () => {
  let service: CollectionsService;
  let consultas: jest.Mock;

  /** Las tres consultas que hace `find`, en orden: filas, totales, recuento. */
  const respondeCon = (
    filas: unknown[],
    totales: Record<string, unknown> = {},
    total = filas.length,
  ) => {
    consultas
      .mockResolvedValueOnce(filas)
      .mockResolvedValueOnce([
        {
          collected: null,
          pending: null,
          refunded: null,
          unreconciled_count: 0,
          unreconciled_amount: null,
          ...totales,
        },
      ])
      .mockResolvedValueOnce([{ total }]);
  };

  const fila = (extra: Record<string, unknown> = {}) => ({
    order_id: 'o-1',
    order_number: 'ORD-20260001',
    client_id: 'c-1',
    client_name: 'Ana Pérez',
    fecha: new Date('2026-10-01T12:00:00Z'),
    amount: '100.00',
    method: 'tropipay',
    estado: 'cobrado',
    origen: 'pasarela',
    descuadre: false,
    reference: 'ref-1',
    ...extra,
  });

  beforeEach(async () => {
    consultas = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        {
          provide: getRepositoryToken(Order),
          useValue: { manager: { query: consultas } },
        },
      ],
    }).compile();
    service = module.get(CollectionsService);
  });

  it('traduce una fila cruda a la que lee el panel', async () => {
    respondeCon([fila()], { collected: '100.00' });

    const r = await service.find({});

    expect(r.rows).toEqual([
      {
        orderId: 'o-1',
        orderNumber: 'ORD-20260001',
        clientId: 'c-1',
        clientName: 'Ana Pérez',
        date: new Date('2026-10-01T12:00:00Z'),
        amount: '100.00',
        method: 'tropipay',
        status: 'cobrado',
        origin: 'pasarela',
        unreconciled: false,
        reference: 'ref-1',
      },
    ]);
    expect(r.totals.collected).toBe('100.00');
  });

  /**
   * Un periodo sin movimiento tiene que decir «0.00» y no «null»: el panel
   * pinta el total tal cual, y un hueco se lee como un fallo de carga.
   */
  it('un periodo vacío da ceros, no nulos', async () => {
    respondeCon([], {}, 0);

    const r = await service.find({});

    expect(r.totals).toEqual({
      collected: '0.00',
      pending: '0.00',
      refunded: '0.00',
      unreconciledCount: 0,
      unreconciledAmount: '0.00',
    });
  });

  /**
   * Lo que de verdad puede salir mal en silencio: que un filtro no llegue al
   * SQL. Se comprueba la cláusula generada y el valor que se pasa, no el
   * resultado — porque el resultado lo decide el doble.
   */
  it('cada filtro llega al SQL como parámetro, no interpolado', async () => {
    respondeCon([]);

    await service.find({
      from: '2026-10-01',
      to: '2026-10-12',
      status: 'cobrado',
      origin: 'manual',
      method: 'usdt-bep-20',
    });

    const [sql, params] = consultas.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('fecha >= $1::timestamptz');
    expect(sql).toContain('estado = $3');
    expect(sql).toContain('origen = $4');
    expect(sql).toContain('method = $5');
    expect(params).toEqual([
      '2026-10-01',
      '2026-10-12',
      'cobrado',
      'manual',
      'usdt-bep-20',
    ]);
  });

  /**
   * `to` es inclusive y se compara contra el día siguiente. Con `<= $to`, un
   * filtro «hasta el 12» se dejaba fuera todo lo cobrado ese día después de
   * medianoche — o sea, todo.
   */
  it('el «hasta» cuenta el día entero', async () => {
    respondeCon([]);

    await service.find({ to: '2026-10-12' });

    const [sql] = consultas.mock.calls[0] as [string];
    expect(sql).toContain("fecha < ($1::date + interval '1 day')");
    expect(sql).not.toMatch(/fecha\s*<=/);
  });

  it('sin filtros no genera WHERE', async () => {
    respondeCon([]);

    await service.find({});

    const [sql, params] = consultas.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('WHERE fecha');
    expect(params).toEqual([]);
  });

  /**
   * Los totales se piden sobre el periodo entero, así que la consulta de
   * totales **no puede llevar LIMIT**. Si alguien la copia de la de filas y se
   * deja el LIMIT, los totales sumarían solo la página y nadie lo notaría
   * hasta que hubiera más de una.
   */
  it('los totales no se limitan a la página', async () => {
    respondeCon([fila()], { collected: '100.00' }, 500);

    await service.find({ page: 3, limit: 10 });

    const [sqlFilas] = consultas.mock.calls[0] as [string];
    const [sqlTotales] = consultas.mock.calls[1] as [string];
    expect(sqlFilas).toContain('LIMIT 10 OFFSET 20');
    // Se busca **la forma de la paginación**, no la palabra `LIMIT`: el CTE
    // compartido lleva un `LIMIT 1` dentro, para quedarse con el último método
    // escrito en el historial. Buscar la palabra suelta daba un falso rojo.
    expect(sqlTotales).not.toMatch(/LIMIT\s+\d+\s+OFFSET/);
    expect(sqlTotales).not.toContain('OFFSET');
  });

  /** El descuadre y el origen son independientes: hay que poder tener los dos. */
  it('un cobro de pasarela marcado a mano sale como pasarela y descuadrado', async () => {
    respondeCon([fila({ origen: 'pasarela', descuadre: true })], {
      collected: '100.00',
      unreconciled_count: 1,
      unreconciled_amount: '100.00',
    });

    const r = await service.find({});

    expect(r.rows[0].origin).toBe('pasarela');
    expect(r.rows[0].unreconciled).toBe(true);
    expect(r.totals.unreconciledCount).toBe(1);
  });

  it('no cuenta pedidos borrados ni los que no tienen pago ninguno', async () => {
    respondeCon([]);

    await service.find({});

    const [sql] = consultas.mock.calls[0] as [string];
    expect(sql).toContain('o.deleted_at IS NULL');
    expect(sql).toContain("o.payment_status IN ('paid', 'refunded')");
  });
});
