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

  beforeEach(async () => {
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
    it('should return all clients', async () => {
      repository.find.mockResolvedValue([client]);
      const result = await service.findAll();
      expect(result).toEqual([client]);
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
