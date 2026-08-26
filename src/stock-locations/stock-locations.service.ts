import { contieneSinTildes } from '../common/search/accent-insensitive';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import {
  LOCATION_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import { Role, User } from '../users/entities/user.entity';
import { CreateStockLocationDto } from './dto/create-stock-location.dto';
import { UpdateStockLocationDto } from './dto/update-stock-location.dto';
import { StockLocationResponseDto } from './dto/stock-location-response.dto';
import { CoverageItemDto } from './dto/coverage-item.dto';
import { PickupAddressItemDto } from './dto/pickup-address-item.dto';
import { StockLocation } from './entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from './entities/stock-location-coverage.entity';
import { StockLocationGrocer } from './entities/stock-location-grocer.entity';
import { StockLocationPickupAddress } from './entities/stock-location-pickup-address.entity';

export interface StockLocationFilters {
  q?: string;
  isActive?: boolean;
}

// Normalized coverage row ready to persist.
interface CoverageRow {
  coverageType: CoverageType;
  provinceId: string;
  municipalityId: string | null;
}

@Injectable()
export class StockLocationsService {
  constructor(
    @InjectRepository(StockLocation)
    private readonly locationRepository: Repository<StockLocation>,
    @InjectRepository(StockLocationCoverage)
    private readonly coverageRepository: Repository<StockLocationCoverage>,
    @InjectRepository(StockLocationGrocer)
    private readonly grocerRepository: Repository<StockLocationGrocer>,
    @InjectRepository(StockLocationPickupAddress)
    private readonly pickupAddressRepository: Repository<StockLocationPickupAddress>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly geographyService: GeographyService,
    private readonly dataSource: DataSource,
    private readonly revalidationService: RevalidationService,
  ) {}

  async findAll(
    user: User,
    filters: StockLocationFilters = {},
  ): Promise<StockLocationResponseDto[]> {
    const where: FindOptionsWhere<StockLocation> = {};
    if (filters.q) {
      where.name = contieneSinTildes(filters.q);
    }
    if (filters.isActive != null) {
      where.isActive = filters.isActive;
    }
    if (!this.isManager(user)) {
      const assignedIds = await this.assignedLocationIds(user.id);
      if (assignedIds.length === 0) return [];
      where.id = In(assignedIds);
    }

    const locations = await this.locationRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    if (locations.length === 0) return [];

    const ids = locations.map((l) => l.id);
    const [coverage, grocers, pickupAddresses] = await Promise.all([
      this.coverageRepository.find({ where: { locationId: In(ids) } }),
      this.grocerRepository.find({ where: { locationId: In(ids) } }),
      this.pickupAddressRepository.find({ where: { locationId: In(ids) } }),
    ]);

    return locations.map((location) =>
      StockLocationResponseDto.build(
        location,
        coverage.filter((c) => c.locationId === location.id),
        grocers.filter((g) => g.locationId === location.id),
        pickupAddresses.filter((a) => a.locationId === location.id),
      ),
    );
  }

  async findOne(user: User, id: string): Promise<StockLocationResponseDto> {
    const location = await this.getLocationOrThrow(id);
    if (!this.isManager(user)) {
      await this.assertGrocerAssigned(user, id);
    }
    return this.buildResponse(location);
  }

  async create(
    user: User,
    dto: CreateStockLocationDto,
  ): Promise<StockLocationResponseDto> {
    const coverage = await this.validateCoverage(dto.coverage);
    // create is admin-only (controller), so grocerIds are always honored here.
    const grocerIds = await this.validateGrocerIds(dto.grocerIds ?? []);

    const location = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(StockLocation).save(
        manager.getRepository(StockLocation).create({
          name: dto.name,
          isActive: dto.isActive ?? true,
        }),
      );
      await this.writeCoverage(manager, saved.id, coverage);
      await this.writeGrocers(manager, saved.id, grocerIds);
      await this.writePickupAddresses(
        manager,
        saved.id,
        dto.pickupAddresses ?? [],
      );
      return saved;
    });

    this.revalidationService.notify(LOCATION_REVALIDATE_TAGS);
    return this.buildResponse(location);
  }

  async update(
    user: User,
    id: string,
    dto: UpdateStockLocationDto,
  ): Promise<StockLocationResponseDto> {
    const location = await this.getLocationOrThrow(id);
    const manager = this.isManager(user);
    if (!manager) {
      await this.assertGrocerAssigned(user, id);
    }

    const coverage =
      dto.coverage !== undefined
        ? await this.validateCoverage(dto.coverage)
        : undefined;
    // Only admins can reassign grocers; silently ignore for grocers.
    const grocerIds =
      manager && dto.grocerIds !== undefined
        ? await this.validateGrocerIds(dto.grocerIds)
        : undefined;

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(StockLocation);
      if (dto.name !== undefined) location.name = dto.name;
      if (dto.isActive !== undefined) location.isActive = dto.isActive;
      await repo.save(location);

      if (coverage !== undefined) {
        await tx
          .getRepository(StockLocationCoverage)
          .delete({ locationId: id });
        await this.writeCoverage(tx, id, coverage);
      }
      if (grocerIds !== undefined) {
        await tx.getRepository(StockLocationGrocer).delete({ locationId: id });
        await this.writeGrocers(tx, id, grocerIds);
      }
      if (dto.pickupAddresses !== undefined) {
        await tx
          .getRepository(StockLocationPickupAddress)
          .delete({ locationId: id });
        await this.writePickupAddresses(tx, id, dto.pickupAddresses);
      }
    });

    this.revalidationService.notify(LOCATION_REVALIDATE_TAGS);

    const fresh = await this.getLocationOrThrow(id);
    return this.buildResponse(fresh);
  }

  async remove(id: string): Promise<void> {
    await this.getLocationOrThrow(id);
    await this.locationRepository.softDelete(id);
    this.revalidationService.notify(LOCATION_REVALIDATE_TAGS);
  }

  // ---------------- Public helpers (used by the inventory module) ----------------

  // Ensures the user may operate on this storage: managers always may; a grocer
  // must be assigned to it. Returns the location entity.
  async assertCanManage(
    user: User,
    locationId: string,
  ): Promise<StockLocation> {
    const location = await this.getLocationOrThrow(locationId);
    if (!this.isManager(user)) {
      await this.assertGrocerAssigned(user, locationId);
    }
    return location;
  }

  // For transfer destinations: the location must exist and be active.
  async getActiveLocationOrThrow(id: string): Promise<StockLocation> {
    const location = await this.getLocationOrThrow(id);
    if (!location.isActive) {
      throw new BadRequestException(`Stock location "${id}" is not active`);
    }
    return location;
  }

  // ---------------- Internal helpers ----------------

  private isManager(user: User): boolean {
    return user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN;
  }

  private async assignedLocationIds(grocerId: string): Promise<string[]> {
    const rows = await this.grocerRepository.find({ where: { grocerId } });
    return rows.map((r) => r.locationId);
  }

  private async assertGrocerAssigned(
    user: User,
    locationId: string,
  ): Promise<void> {
    const assignment = await this.grocerRepository.findOne({
      where: { locationId, grocerId: user.id },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'You are not assigned to this stock location',
      );
    }
  }

  private async getLocationOrThrow(id: string): Promise<StockLocation> {
    const location = await this.locationRepository.findOne({ where: { id } });
    if (!location) {
      throw new NotFoundException(`Stock location with id "${id}" not found`);
    }
    return location;
  }

  private async buildResponse(
    location: StockLocation,
  ): Promise<StockLocationResponseDto> {
    const [coverage, grocers, pickupAddresses] = await Promise.all([
      this.coverageRepository.find({ where: { locationId: location.id } }),
      this.grocerRepository.find({ where: { locationId: location.id } }),
      this.pickupAddressRepository.find({ where: { locationId: location.id } }),
    ]);
    return StockLocationResponseDto.build(
      location,
      coverage,
      grocers,
      pickupAddresses,
    );
  }

  // Validates FKs + municipality/province consistency, dedups, and normalizes.
  private async validateCoverage(
    items: CoverageItemDto[],
  ): Promise<CoverageRow[]> {
    const seen = new Set<string>();
    const rows: CoverageRow[] = [];

    for (const item of items) {
      await this.geographyService.getProvinceOrThrow(item.provinceId);

      let municipalityId: string | null = null;
      if (item.coverageType === CoverageType.MUNICIPALITY) {
        if (!item.municipalityId) {
          throw new BadRequestException(
            'municipalityId is required for municipality coverage',
          );
        }
        const municipality = await this.geographyService.getMunicipalityOrThrow(
          item.municipalityId,
        );
        if (municipality.provinceId !== item.provinceId) {
          throw new BadRequestException(
            'municipality does not belong to the given province',
          );
        }
        municipalityId = item.municipalityId;
      }

      const key = `${item.provinceId}:${municipalityId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        coverageType: item.coverageType,
        provinceId: item.provinceId,
        municipalityId,
      });
    }

    return rows;
  }

  // Ensures every id is an existing GROCER; returns a deduped list.
  private async validateGrocerIds(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];

    const users = await this.userRepository.find({
      where: { id: In(unique) },
    });
    if (users.length !== unique.length) {
      throw new BadRequestException('One or more grocer ids do not exist');
    }
    const nonGrocer = users.find((u) => u.role !== Role.GROCER);
    if (nonGrocer) {
      throw new BadRequestException(
        `User "${nonGrocer.id}" is not a GROCER and cannot be assigned`,
      );
    }
    return unique;
  }

  private async writeCoverage(
    manager: EntityManager,
    locationId: string,
    rows: CoverageRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const repo = manager.getRepository(StockLocationCoverage);
    await repo.save(rows.map((r) => repo.create({ locationId, ...r })));
  }

  private async writeGrocers(
    manager: EntityManager,
    locationId: string,
    grocerIds: string[],
  ): Promise<void> {
    if (grocerIds.length === 0) return;
    const repo = manager.getRepository(StockLocationGrocer);
    await repo.save(
      grocerIds.map((grocerId) => repo.create({ locationId, grocerId })),
    );
  }

  private async writePickupAddresses(
    manager: EntityManager,
    locationId: string,
    items: PickupAddressItemDto[],
  ): Promise<void> {
    if (items.length === 0) return;
    const repo = manager.getRepository(StockLocationPickupAddress);
    await repo.save(
      items.map((item) =>
        repo.create({
          locationId,
          label: item.label?.trim() || null,
          address: item.address.trim(),
        }),
      ),
    );
  }
}
