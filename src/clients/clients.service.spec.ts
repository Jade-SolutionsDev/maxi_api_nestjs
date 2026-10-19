import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { ClientInvitationsService } from './client-invitations.service';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

describe('ClientsService', () => {
  let service: ClientsService;
  let repository: jest.Mocked<Repository<Client>>;
  let invitaciones: { listarPendientes: jest.Mock };
  let geography: { getMunicipalityOrThrow: jest.Mock };

  const client: Client = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkId: 'clerk_client_1',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    defaultMunicipalityId: null,
    isActive: true,
    adminInvitePending: false,
    onboardingCompleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  /**
   * El constructor de consultas encadena, así que cada método devuelve el
   * propio objeto. Se guarda lo que recibe `andWhere` y `orderBy` porque es
   * justo lo que se quiere comprobar: que el texto llega al SQL y que la
   * ordenación no acepta lo que le manden.
   */
  let qb: {
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
    getCount: jest.Mock;
  };

  beforeEach(async () => {
    invitaciones = { listarPendientes: jest.fn(() => Promise.resolve([])) };
    geography = { getMunicipalityOrThrow: jest.fn() };
    qb = {
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(() => Promise.resolve([[client], 1])),
      getCount: jest.fn(() => Promise.resolve(1)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: ClientInvitationsService,
          useValue: invitaciones,
        },
        {
          provide: GeographyService,
          useValue: geography,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            merge: jest.fn((entity: Client, dto: Partial<Client>) =>
              Object.assign(entity, dto),
            ),
            softDelete: jest.fn(),
            createQueryBuilder: jest.fn(() => qb),
            // `findBeneficiaries` agrega sobre un campo JSON y acaba en SQL.
            // El doble devuelve lo que se le diga por consulta, en orden.
            manager: { query: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
    repository = module.get(getRepositoryToken(Client));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('devuelve la página con su total', async () => {
      const result = await service.findAll({}, { page: 1, limit: 20 });

      expect(result.data).toEqual([client]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('busca el texto en nombre, apellidos, correo y teléfono', async () => {
      await service.findAll({ q: 'aurelio' });

      const [condicion, parametros] = qb.andWhere.mock.calls[0] as [
        string,
        { q: string },
      ];
      for (const campo of ['firstName', 'lastName', 'email', 'phone']) {
        expect(condicion).toContain(`client.${campo}`);
      }
      expect(parametros).toEqual({ q: '%aurelio%' });
    });

    it('también busca por nombre y apellidos escritos como una frase', async () => {
      await service.findAll({ q: 'Aurelio García' });

      const [condicion] = qb.andWhere.mock.calls[0] as [string];
      expect(condicion).toContain(
        "concat_ws(' ', client.firstName, client.lastName)",
      );
    });

    // Sin esto la búsqueda se perdería por una tilde, que en español es la
    // mitad de las veces. Ver la decisión D-021.
    it('dobla los acentos por los dos lados', async () => {
      await service.findAll({ q: 'almibar' });

      const [condicion] = qb.andWhere.mock.calls[0] as [string];
      expect(condicion).toContain('f_unaccent');
    });

    it('filtra por estado cuando se pide', async () => {
      await service.findAll({ isActive: false });

      expect(qb.andWhere).toHaveBeenCalledWith('client.isActive = :isActive', {
        isActive: false,
      });
    });

    it('resuelve una lista de identificadores sueltos', async () => {
      await service.findAll({ ids: ['a', 'b'] });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
      );
    });

    it('ordena por el campo pedido', async () => {
      await service.findAll({}, { sortBy: 'email', sortOrder: 'asc' });

      expect(qb.orderBy).toHaveBeenCalledWith('client.email', 'ASC');
    });

    // `sortBy` llega de la URL y termina dentro de un ORDER BY.
    it('ignora un campo de ordenación que no esté en la lista', async () => {
      await service.findAll({}, { sortBy: 'clerkId; DROP TABLE clients' });

      expect(qb.orderBy).toHaveBeenCalledWith('client.createdAt', 'DESC');
    });

    it('salta las páginas anteriores', async () => {
      await service.findAll({}, { page: 3, limit: 20 });

      expect(qb.skip).toHaveBeenCalledWith(40);
      expect(qb.take).toHaveBeenCalledWith(20);
    });
  });

  describe('findOne', () => {
    it('should return a client by id', async () => {
      repository.findOne.mockResolvedValue(client);
      const result = await service.findOne(client.id);
      expect(result).toEqual(client);
    });

    it('should throw NotFoundException when client is missing', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne(client.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createOrUpdateFromClerk', () => {
    it('should create a new client from Clerk data', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(client);
      repository.save.mockResolvedValue(client);

      const result = await service.createOrUpdateFromClerk(client.clerkId, {
        email: client.email ?? undefined,
        firstName: client.firstName ?? undefined,
        lastName: client.lastName ?? undefined,
      });

      expect(result).toEqual(client);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ clerkId: client.clerkId }),
      );
    });

    it('should update an existing client from Clerk data', async () => {
      repository.findOne.mockResolvedValue({ ...client });
      repository.save.mockImplementation((c) => Promise.resolve(c as Client));

      const result = await service.createOrUpdateFromClerk(client.clerkId, {
        firstName: 'Updated',
      });

      expect(result.firstName).toBe('Updated');
    });
  });

  describe('create', () => {
    const createDto: CreateClientDto = {
      clerkId: 'clerk_client_2',
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('should create a client with lowercased email', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(client);
      repository.save.mockResolvedValue(client);

      const result = await service.create(createDto);

      expect(result).toEqual(client);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkId: createDto.clerkId,
          email: 'jane@example.com',
        }),
      );
    });

    it('should throw ConflictException for duplicate email', async () => {
      repository.findOne.mockResolvedValue(client);
      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('should update a client', async () => {
      repository.findOne.mockResolvedValue({ ...client });
      repository.save.mockImplementation((c) => Promise.resolve(c as Client));

      const updateDto: UpdateClientDto = { firstName: 'Janet' };
      const result = await service.update(client.id, updateDto);

      expect(result.firstName).toBe('Janet');
    });
  });

  describe('remove', () => {
    it('should soft delete a client', async () => {
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      await service.remove(client.id);
      expect(repository.softDelete).toHaveBeenCalledWith(client.id);
    });
  });

  describe('invitaciones pendientes en el listado', () => {
    /** Una invitación vestida de cliente: sin cuenta en Clerk todavía. */
    const pendiente = {
      ...client,
      id: 'inv_1',
      clerkId: null as unknown as string,
      email: 'dayana@ejemplo.com',
      firstName: 'Dayana',
      lastName: 'Pérez',
      isActive: false,
    } as Client;

    it('no las pide si no se las piden', async () => {
      await service.findAll({});

      expect(invitaciones.listarPendientes).not.toHaveBeenCalled();
    });

    it('las antepone al listado y las cuenta en el total', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      const r = await service.findAll({ includeInvitations: true });

      expect(r.data[0].id).toBe('inv_1');
      expect(r.data).toHaveLength(2);
      expect(r.meta.total).toBe(2);
    });

    it('solo salen en la primera página', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      const r = await service.findAll(
        { includeInvitations: true },
        { page: 2 },
      );

      // Siguen contando en el total —si no, la paginación mentiría— pero no se
      // repiten en cada página.
      expect(r.data.map((c) => c.id)).not.toContain('inv_1');
      expect(r.meta.total).toBe(2);
    });

    it('descuenta las invitaciones del límite de la página', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      await service.findAll({ includeInvitations: true }, { limit: 10 });

      // Con 1 invitación delante, a la tabla se le piden 9 filas y no 10: si
      // no, la página devuelve 11 y el pie del listado dice «1 - 10».
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(9);
    });

    it('la página 2 arranca donde acabó la 1, no en el límite', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      await service.findAll(
        { includeInvitations: true },
        { page: 2, limit: 10 },
      );

      // La página 1 enseñó la invitación y 9 clientes, así que la 2 empieza en
      // el 10.º cliente. Saltar 10 se habría comido uno.
      expect(qb.skip).toHaveBeenCalledWith(9);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('si las invitaciones llenan la página no se pide nada a la tabla', async () => {
      invitaciones.listarPendientes.mockResolvedValue([
        pendiente,
        { ...pendiente, id: 'inv_2' },
      ]);

      const r = await service.findAll(
        { includeInvitations: true },
        { limit: 2 },
      );

      expect(qb.getManyAndCount).not.toHaveBeenCalled();
      expect(r.data.map((c) => c.id)).toEqual(['inv_1', 'inv_2']);
      // El total sigue contando los clientes que hay detrás.
      expect(r.meta.total).toBe(3);
    });

    it('el buscador también filtra las invitaciones', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      const r = await service.findAll({
        includeInvitations: true,
        q: 'dayana',
      });
      expect(r.data.map((c) => c.id)).toContain('inv_1');

      const otra = await service.findAll({
        includeInvitations: true,
        q: 'ramon',
      });
      expect(otra.data.map((c) => c.id)).not.toContain('inv_1');
    });

    it('busca sin tildes, como el SQL del listado', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      const r = await service.findAll({ includeInvitations: true, q: 'perez' });

      expect(r.data.map((c) => c.id)).toContain('inv_1');
    });

    it('filtrar por activo o inactivo las deja fuera', async () => {
      invitaciones.listarPendientes.mockResolvedValue([pendiente]);

      // Son facetas excluyentes: quien pide «inactivos» quiere clientes
      // desactivados, no gente que todavía no tiene cuenta.
      const r = await service.findAll({
        includeInvitations: true,
        isActive: false,
      });

      expect(invitaciones.listarPendientes).not.toHaveBeenCalled();
      expect(r.data.map((c) => c.id)).not.toContain('inv_1');
    });
  });
  /**
   * La zona que el cliente elige en la tienda (MxH-0040).
   *
   * Hasta ahora `default_municipality_id` solo lo escribía el panel, y en
   * staging estaba vacío en los 24 clientes: los tres respaldos que la API ya
   * tiene escritos —dos en pedidos y uno en entregas— no se disparaban nunca.
   */
  describe('saveDefaultMunicipality', () => {
    const municipio = { id: 'mun-1', isActive: true };

    beforeEach(() => {
      repository.findOne.mockResolvedValue({ ...client });
      repository.save.mockImplementation((entity) =>
        Promise.resolve(entity as Client),
      );
    });

    it('guarda la zona y da el alta por terminada', async () => {
      geography.getMunicipalityOrThrow.mockResolvedValue(municipio);

      const guardado = await service.saveDefaultMunicipality(
        client.id,
        'mun-1',
      );

      expect(guardado.defaultMunicipalityId).toBe('mun-1');
      // Es la misma definición que usa el alta desde el panel: tener municipio
      // por defecto **es** haber terminado el alta.
      expect(guardado.onboardingCompleted).toBe(true);
    });

    it('rechaza un municipio que no existe, y no escribe nada', async () => {
      geography.getMunicipalityOrThrow.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        service.saveDefaultMunicipality(client.id, 'mun-inventado'),
      ).rejects.toThrow(NotFoundException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rechaza un municipio dado de baja, y tampoco escribe', async () => {
      // Ninguna pantalla lo ofrece, así que llegar aquí con uno solo puede
      // venir de una petición hecha a mano.
      geography.getMunicipalityOrThrow.mockResolvedValue({
        ...municipio,
        isActive: false,
      });

      await expect(
        service.saveDefaultMunicipality(client.id, 'mun-1'),
      ).rejects.toThrow(NotFoundException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('valida el municipio antes de buscar al cliente', async () => {
      // El orden importa poco para el resultado y mucho para la base: una
      // zona inválida no tiene por qué costar una consulta de cliente.
      geography.getMunicipalityOrThrow.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        service.saveDefaultMunicipality(client.id, 'mun-inventado'),
      ).rejects.toThrow(NotFoundException);

      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });
});

describe('ClientsService · findBeneficiaries', () => {
  let service: ClientsService;
  let consultas: jest.Mock;

  const cliente = (phone: string | null) =>
    ({
      id: 'c-1',
      clerkId: 'clerk_1',
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      phone,
      avatarUrl: null,
      defaultMunicipalityId: null,
      isActive: true,
      adminInvitePending: false,
      onboardingCompleted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as Client;

  const montar = async (phoneDelCliente: string | null) => {
    consultas = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: ClientInvitationsService,
          useValue: { listarPendientes: jest.fn() },
        },
        {
          provide: GeographyService,
          useValue: { getMunicipalityOrThrow: jest.fn() },
        },
        {
          provide: getRepositoryToken(Client),
          useValue: {
            findOne: jest.fn(() => Promise.resolve(cliente(phoneDelCliente))),
            manager: { query: consultas },
          },
        },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);
  };

  it('devuelve cada beneficiario con sus veces y su última fecha', async () => {
    await montar(null);
    const ultimo = new Date('2026-09-30T10:00:00Z');
    consultas
      .mockResolvedValueOnce([
        {
          nombre: 'Merlinda Vargas',
          carne: '85072045678',
          telefono: '+53 5251 9414',
          veces: 3,
          ultimo,
        },
      ])
      .mockResolvedValueOnce([{ sin_destinatario: 7 }]);

    const r = await service.findBeneficiaries('c-1');

    expect(r.beneficiaries).toEqual([
      {
        name: 'Merlinda Vargas',
        idCard: '85072045678',
        phone: '+53 5251 9414',
        timesReceived: 3,
        lastOrderAt: ultimo,
        samePhoneAsClient: false,
      },
    ]);
    expect(r.ordersWithoutRecipient).toBe(7);
  });

  /**
   * Lo único que se puede medir sobre «es el propio cliente». El cliente no
   * guarda carné, y su nombre viene de Clerk mientras el del beneficiario se
   * escribe a mano, así que comparar nombres no vale. Se comparan solo los
   * dígitos porque los dos lados se escriben con formatos distintos.
   */
  it('marca el teléfono que coincide con el del cliente, con prefijo o sin él', async () => {
    await montar('+53 5251 9414');
    consultas
      .mockResolvedValueOnce([
        {
          nombre: 'Sin prefijo',
          carne: null,
          telefono: '52519414',
          veces: 1,
          ultimo: new Date(),
        },
        {
          nombre: 'Con prefijo',
          carne: null,
          telefono: '+53 5251 9414',
          veces: 1,
          ultimo: new Date(),
        },
        {
          nombre: 'Otro',
          carne: null,
          telefono: '55667788',
          veces: 1,
          ultimo: new Date(),
        },
        {
          nombre: 'Demasiado corto',
          carne: null,
          telefono: '9414',
          veces: 1,
          ultimo: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ sin_destinatario: 0 }]);

    const r = await service.findBeneficiaries('c-1');

    expect(r.beneficiaries.map((b) => b.samePhoneAsClient)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('un cliente sin teléfono no marca nada', async () => {
    await montar(null);
    consultas
      .mockResolvedValueOnce([
        {
          nombre: 'Ana',
          carne: null,
          telefono: null,
          veces: 1,
          ultimo: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ sin_destinatario: 0 }]);

    const r = await service.findBeneficiaries('c-1');

    expect(r.beneficiaries[0].samePhoneAsClient).toBe(false);
  });

  /**
   * La agrupación es la parte que puede equivocarse en silencio: por carné
   * cuando lo hay y por nombre+teléfono cuando no. Si alguien la cambia a solo
   * carné, los pedidos viejos sin carné se juntarían en una fila falsa.
   */
  it('agrupa por carné cuando lo hay y por nombre+teléfono cuando no', async () => {
    await montar(null);
    consultas
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sin_destinatario: 0 }]);

    await service.findBeneficiaries('c-1');

    const sql = consultas.mock.calls[0][0] as string;
    expect(sql).toContain(
      "GROUP BY coalesce(carne, lower(nombre) || '|' || coalesce(telefono, ''))",
    );
  });

  it('no cuenta los pedidos borrados', async () => {
    await montar(null);
    consultas
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sin_destinatario: 0 }]);

    await service.findBeneficiaries('c-1');

    for (const [sql] of consultas.mock.calls) {
      expect(sql as string).toContain('o.deleted_at IS NULL');
    }
  });

  it('404 si el cliente no existe', async () => {
    consultas = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: ClientInvitationsService,
          useValue: { listarPendientes: jest.fn() },
        },
        {
          provide: GeographyService,
          useValue: { getMunicipalityOrThrow: jest.fn() },
        },
        {
          provide: getRepositoryToken(Client),
          useValue: {
            findOne: jest.fn(() => Promise.resolve(null)),
            manager: { query: consultas },
          },
        },
      ],
    }).compile();
    service = module.get<ClientsService>(ClientsService);

    await expect(service.findBeneficiaries('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(consultas).not.toHaveBeenCalled();
  });
});
