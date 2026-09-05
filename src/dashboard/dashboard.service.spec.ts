import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import {
  DashboardClientsRow,
  DashboardOrdersRow,
  DashboardProductsRow,
} from './dto/dashboard-stats-response.dto';
import { DashboardTopProductRow } from './dto/dashboard-top-products-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-09-03T12:00:00.000Z');

const makeOrdersRow = (
  overrides: Partial<DashboardOrdersRow> = {},
): DashboardOrdersRow => ({
  revenue_current: '1234.50',
  revenue_previous: '1000.00',
  orders_current: 12,
  orders_previous: 10,
  ...overrides,
});

const makeProductsRow = (
  overrides: Partial<DashboardProductsRow> = {},
): DashboardProductsRow => ({
  active: 342,
  new_current: 24,
  new_previous: 19,
  ...overrides,
});

const makeClientsRow = (
  overrides: Partial<DashboardClientsRow> = {},
): DashboardClientsRow => ({
  new_current: 86,
  new_previous: 74,
  ...overrides,
});

type DataSourceMock = { query: jest.Mock };

/** The SQL each call received, keyed by the table it reads. */
const sqlPorTabla = (dataSource: DataSourceMock) => {
  const sqls = dataSource.query.mock.calls.map(([sql]: [string]) => sql);
  return {
    orders: sqls.find((s) => s.includes('FROM orders')) as string,
    products: sqls.find((s) => s.includes('FROM products')) as string,
    clients: sqls.find((s) => s.includes('FROM clients')) as string,
    todos: sqls,
  };
};

describe('DashboardService', () => {
  let service: DashboardService;
  let dataSource: DataSourceMock;

  const seed = (
    orders = makeOrdersRow(),
    products = makeProductsRow(),
    clients = makeClientsRow(),
  ) => {
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve([
        sql.includes('FROM orders')
          ? orders
          : sql.includes('FROM products')
            ? products
            : clients,
      ]),
    );
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(AHORA);
    dataSource = { query: jest.fn() };
    seed();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa el mismo instante para las tres consultas', async () => {
    await service.getStats();

    expect(dataSource.query).toHaveBeenCalledTimes(3);
    const [primero, segundo, tercero] = dataSource.query.mock.calls.map(
      ([, params]: [string, Date[]]) => params,
    );
    // Si cada statement llamara a new Date() por su cuenta podría quedar a
    // caballo de un borde y reportar ventanas distintas.
    expect(segundo).toEqual(primero);
    expect(tercero).toEqual(primero);
  });

  it('abre una ventana de 30 días y la anterior', async () => {
    const dto = await service.getStats();

    const [previousFrom, from, to] = dataSource.query.mock
      .calls[0][1] as Date[];
    expect(to).toEqual(AHORA);
    expect(from).toEqual(new Date(AHORA.getTime() - 30 * DAY_MS));
    expect(previousFrom).toEqual(new Date(AHORA.getTime() - 60 * DAY_MS));
    expect(dto.period).toEqual({
      days: 30,
      previousFrom: new Date(AHORA.getTime() - 60 * DAY_MS).toISOString(),
      from: new Date(AHORA.getTime() - 30 * DAY_MS).toISOString(),
      to: AHORA.toISOString(),
    });
  });

  it('respeta la ventana de 7 días', async () => {
    const dto = await service.getStats(7);

    const [previousFrom, from] = dataSource.query.mock.calls[0][1] as Date[];
    expect(from).toEqual(new Date(AHORA.getTime() - 7 * DAY_MS));
    expect(previousFrom).toEqual(new Date(AHORA.getTime() - 14 * DAY_MS));
    expect(dto.period.days).toBe(7);
  });

  it('excluye los pedidos cancelados de la facturación pero no del conteo', async () => {
    await service.getStats();

    const { orders } = sqlPorTabla(dataSource);
    const revenue = orders
      .split('\n')
      .filter((linea) => linea.includes('SUM(o.total)'));
    expect(revenue).toHaveLength(2);
    expect(orders).toContain("o.status <> 'cancelled'");

    const conteos = orders
      .split('\n')
      .filter((linea) => linea.includes('COUNT(*) FILTER'));
    expect(conteos).toHaveLength(2);
    conteos.forEach((linea) => expect(linea).not.toContain('cancelled'));
  });

  it('la facturación cuenta solo lo cobrado, el conteo de pedidos no', async () => {
    await service.getStats();

    const { orders } = sqlPorTabla(dataSource);
    // revenue = plata que entró: exige el pago conciliado.
    const revenue = orders
      .split('revenue_')
      .slice(0, 2)
      .join('revenue_')
      .split('COALESCE(SUM(o.total)');
    expect(revenue.length).toBeGreaterThan(1);
    const pagos = orders.match(/o\.payment_status = 'paid'/g) ?? [];
    expect(pagos).toHaveLength(2);

    // El conteo mide demanda: no filtra ni cancelados ni pago.
    const conteos = orders
      .split('\n')
      .filter((linea) => linea.includes('COUNT(*) FILTER'));
    expect(conteos).toHaveLength(2);
    conteos.forEach((linea) => expect(linea).not.toContain('payment_status'));
  });

  it('ignora las filas borradas en las tres consultas', async () => {
    await service.getStats();

    const { todos } = sqlPorTabla(dataSource);
    todos.forEach((sql) => expect(sql).toContain('deleted_at IS NULL'));
  });

  it('no cuenta como cliente nuevo una invitación sin aceptar', async () => {
    await service.getStats();

    expect(sqlPorTabla(dataSource).clients).toContain(
      'admin_invite_pending = false',
    );
  });

  it('convierte los decimales de Postgres a número', async () => {
    const dto = await service.getStats();

    // El driver devuelve numeric(12,2) como string: sin Number() el front
    // recibiría "1234.50" y la card animaría sobre un texto.
    expect(dto.revenue.current).toBe(1234.5);
    expect(typeof dto.revenue.current).toBe('number');
    expect(dto.revenue.previous).toBe(1000);
  });

  it('devuelve ceros y no NaN cuando no hay datos', async () => {
    seed(
      makeOrdersRow({
        revenue_current: '0',
        revenue_previous: '0',
        orders_current: 0,
        orders_previous: 0,
      }),
      makeProductsRow({ active: 0, new_current: 0, new_previous: 0 }),
      makeClientsRow({ new_current: 0, new_previous: 0 }),
    );

    const dto = await service.getStats();

    const cifras = [
      dto.revenue.current,
      dto.revenue.previous,
      dto.orders.current,
      dto.orders.previous,
      dto.products.active,
      dto.products.current,
      dto.products.previous,
      dto.clients.current,
      dto.clients.previous,
    ];
    cifras.forEach((cifra) => {
      expect(cifra).toBe(0);
      expect(Number.isNaN(cifra)).toBe(false);
    });
  });

  describe('getTopProducts', () => {
    const filas: DashboardTopProductRow[] = [
      {
        product_id: 'p1',
        name: 'Café',
        image_url: 'a.png',
        sold: 80,
        revenue: '800.00',
      },
      {
        product_id: 'p2',
        name: 'Ron',
        image_url: null,
        sold: 45,
        revenue: '450.50',
      },
    ];

    beforeEach(() => {
      dataSource.query.mockResolvedValue(filas);
    });

    it('abre una sola ventana, sin la anterior', async () => {
      const dto = await service.getTopProducts(7);

      const [from, to] = dataSource.query.mock.calls[0][1] as Date[];
      expect(from).toEqual(new Date(AHORA.getTime() - 7 * DAY_MS));
      expect(to).toEqual(AHORA);
      expect(dto.period).toEqual({
        days: 7,
        from: new Date(AHORA.getTime() - 7 * DAY_MS).toISOString(),
        to: AHORA.toISOString(),
      });
    });

    it('pasa el limit como parámetro, no interpolado en el SQL', async () => {
      await service.getTopProducts(30, 3);

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[2]).toBe(3);
      expect(sql).toContain('LIMIT $3');
    });

    it('agrupa por product_id y no por el nombre guardado en la orden', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      // Agrupar por el snapshot partiría en dos un producto renombrado.
      expect(sql).toContain('GROUP BY oi.product_id');
      expect(sql).not.toContain('product_name_snapshot');
    });

    it('excluye cancelados, sin pagar y pedidos borrados', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).toContain("o.status <> 'cancelled'");
      // Misma convención que revenue: una unidad sin cobrar no se vendió.
      expect(sql).toContain("o.payment_status = 'paid'");
      expect(sql).toContain('o.deleted_at IS NULL');
    });

    it('no filtra productos borrados: la venta ocurrió igual', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).not.toContain('p.deleted_at');
    });

    it('ordena con desempate estable por nombre', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).toContain('ORDER BY sold DESC, p.name ASC');
    });

    it('suma el dinero por line_total, no por el precio actual', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      // `line_total` es lo que se cobró, con el descuento congelado al vender.
      expect(sql).toContain('SUM(oi.line_total)');
      // Recalcular con el precio del catálogo movería las ventanas históricas.
      expect(sql).not.toContain('base_price');
      expect(sql).not.toContain('p.discount');
    });

    it('el dinero no manda en el ranking: sigue mandando la unidad', async () => {
      await service.getTopProducts();

      const [sql] = dataSource.query.mock.calls[0] as [string];
      expect(sql).not.toContain('ORDER BY revenue');
    });

    it('mapea las filas al contrato del front', async () => {
      const dto = await service.getTopProducts();

      // `revenue` llega de pg como texto (numeric): sale como número.
      expect(dto.items).toEqual([
        {
          id: 'p1',
          name: 'Café',
          imageUrl: 'a.png',
          sold: 80,
          revenue: 800,
        },
        {
          id: 'p2',
          name: 'Ron',
          imageUrl: null,
          sold: 45,
          revenue: 450.5,
        },
      ]);
      expect(typeof dto.items[0].revenue).toBe('number');
    });

    it('devuelve una lista vacía cuando no hubo ventas', async () => {
      dataSource.query.mockResolvedValue([]);

      const dto = await service.getTopProducts();

      expect(dto.items).toEqual([]);
      expect(dto.period.days).toBe(30);
    });
  });

  it('separa el conteo de productos activos del de nuevos', async () => {
    const dto = await service.getStats();

    // `active` es una foto del catálogo; current/previous solo alimentan el badge.
    expect(dto.products.active).toBe(342);
    expect(dto.products.current).toBe(24);
    expect(dto.products.previous).toBe(19);
    // El WHERE no lleva rango de fechas: la ventana vive solo en los FILTER.
    const where =
      sqlPorTabla(dataSource).products.split('WHERE p.deleted_at')[1];
    expect(where).not.toContain('created_at');
  });
});
