import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

describe('ClientsService', () => {
  let service: ClientsService;
  let repository: jest.Mocked<Repository<Client>>;

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
  };

  beforeEach(async () => {
    qb = {
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn(async () => [[client], 1]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
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
        email: client.email,
        firstName: client.firstName,
        lastName: client.lastName,
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
});
