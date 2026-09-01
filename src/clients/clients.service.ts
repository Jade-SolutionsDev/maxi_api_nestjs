import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  buildPaginatedResponse,
  getPaginationParams,
  type PaginatedResponse,
  type PaginationQueryDto,
} from '../common/dto/pagination.dto';
import { sinTildes } from '../common/search/accent-insensitive';
import { CAMPOS_ORDENABLES } from './dto/list-clients-query.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

export interface FiltroDeClientes {
  /** Texto libre sobre nombre, apellidos, correo y teléfono. */
  q?: string;
  isActive?: boolean;
  ids?: string[];
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
  ) {}

  async findAll(
    filtro: FiltroDeClientes = {},
    paginacion: PaginationQueryDto = {},
  ): Promise<PaginatedResponse<Client>> {
    const { page, limit, skip } = getPaginationParams(paginacion);
    const qb = this.clientsRepository.createQueryBuilder('client');

    if (filtro.ids?.length) {
      qb.andWhere({ id: In(filtro.ids) });
    }

    if (filtro.q) {
      qb.andWhere(
        `(${sinTildes('client.firstName')} OR ${sinTildes('client.lastName')} OR ${sinTildes('client.email')} OR ${sinTildes('client.phone')})`,
        { q: `%${filtro.q}%` },
      );
    }

    if (filtro.isActive !== undefined) {
      qb.andWhere('client.isActive = :isActive', { isActive: filtro.isActive });
    }

    // `id` es la clave primaria: como desempate deja un orden total estable
    // entre peticiones, que es lo que evita que una fila aparezca en dos
    // páginas o en ninguna cuando varias comparten fecha.
    const campo = CAMPOS_ORDENABLES.includes(
      paginacion.sortBy as (typeof CAMPOS_ORDENABLES)[number],
    )
      ? (paginacion.sortBy as string)
      : 'createdAt';
    const sentido = paginacion.sortOrder === 'asc' ? 'ASC' : 'DESC';

    qb.orderBy(`client.${campo}`, sentido)
      .addOrderBy('client.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [clients, total] = await qb.getManyAndCount();
    return buildPaginatedResponse(clients, total, page, limit);
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientsRepository.findOne({ where: { id } });
    if (!client) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
    return client;
  }

  async findByClerkId(
    clerkId: string,
    { withDeleted = false }: { withDeleted?: boolean } = {},
  ): Promise<Client | null> {
    return this.clientsRepository.findOne({ where: { clerkId }, withDeleted });
  }

  async createOrUpdateFromClerk(
    clerkId: string,
    data: Partial<CreateClientDto>,
  ): Promise<Client> {
    const existing = await this.findByClerkId(clerkId);
    if (existing) {
      Object.assign(existing, {
        ...data,
        email: data.email?.toLowerCase() ?? existing.email,
        updatedAt: new Date(),
      });
      return this.clientsRepository.save(existing);
    }

    if (data.email) {
      await this.guardDuplicateEmail(data.email.toLowerCase());
    }

    const client = this.clientsRepository.create({
      ...data,
      clerkId,
      email: data.email?.toLowerCase() ?? null,
      onboardingCompleted: data.defaultMunicipalityId !== undefined,
    });

    return this.clientsRepository.save(client);
  }

  async create(createClientDto: CreateClientDto): Promise<Client> {
    await this.guardDuplicateClerkId(createClientDto.clerkId);
    if (createClientDto.email) {
      await this.guardDuplicateEmail(createClientDto.email.toLowerCase());
    }

    const client = this.clientsRepository.create({
      ...createClientDto,
      email: createClientDto.email?.toLowerCase() ?? null,
      onboardingCompleted:
        createClientDto.defaultMunicipalityId !== undefined ||
        createClientDto.onboardingCompleted === true,
    });

    return this.clientsRepository.save(client);
  }

  async update(id: string, updateClientDto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id);

    this.clientsRepository.merge(client, updateClientDto);
    if (updateClientDto.email) {
      const email = updateClientDto.email.toLowerCase();
      await this.guardDuplicateEmail(email, id);
      client.email = email;
    }

    return this.clientsRepository.save(client);
  }

  async remove(id: string): Promise<void> {
    const result = await this.clientsRepository.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
  }

  async removeByClerkId(clerkId: string): Promise<void> {
    const client = await this.findByClerkId(clerkId);
    if (client) {
      await this.clientsRepository.softDelete(client.id);
    }
  }

  private async guardDuplicateEmail(
    email: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.clientsRepository.findOne({
      where: { email },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A client with email "${email}" already exists`,
      );
    }
  }

  private async guardDuplicateClerkId(
    clerkId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.clientsRepository.findOne({
      where: { clerkId },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A client with clerkId "${clerkId}" already exists`,
      );
    }
  }
}
