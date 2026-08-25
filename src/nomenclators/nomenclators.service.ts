import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import {
  NOMENCLATOR_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import {
  CreateNomenclatorDto,
  UpdateNomenclatorDto,
} from './dto/nomenclator.dto';
import { Nomenclator } from './entities/nomenclator.entity';

// Option catalogs consumed by other verticals (contact motives today). Rows
// referenced by historical records are soft-deleted, never hard-removed, so a
// message keeps resolving its motive after the option is retired.
@Injectable()
export class NomenclatorsService {
  constructor(
    @InjectRepository(Nomenclator)
    private readonly nomenclatorRepository: Repository<Nomenclator>,
    private readonly revalidationService: RevalidationService,
  ) {}

  async listAdmin(category: string): Promise<Nomenclator[]> {
    return this.nomenclatorRepository.find({
      where: { category },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  }

  async listActive(category: string): Promise<Nomenclator[]> {
    return this.nomenclatorRepository.find({
      where: { category, isActive: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  }

  async getOne(id: string): Promise<Nomenclator> {
    const row = await this.nomenclatorRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Nomenclator with id "${id}" not found`);
    }
    return row;
  }

  /** Active option of a given category, or null — for referential checks. */
  async findActiveOption(
    category: string,
    id: string,
  ): Promise<Nomenclator | null> {
    return this.nomenclatorRepository.findOne({
      where: { id, category, isActive: true },
    });
  }

  /** Labels for a set of ids (soft-deleted included: history must resolve). */
  async labelsFor(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.nomenclatorRepository.find({
      where: ids.map((id) => ({ id })),
      withDeleted: true,
    });
    return new Map(rows.map((row) => [row.id, row.label]));
  }

  async create(dto: CreateNomenclatorDto): Promise<Nomenclator> {
    const code = await this.ensureUniqueCode(dto.category, dto.label);
    const row = this.nomenclatorRepository.create({
      category: dto.category,
      code,
      label: dto.label,
      description: dto.description ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.nomenclatorRepository.save(row);
    this.revalidationService.notify(NOMENCLATOR_REVALIDATE_TAGS);
    return saved;
  }

  async update(id: string, dto: UpdateNomenclatorDto): Promise<Nomenclator> {
    const row = await this.getOne(id);
    if (dto.label !== undefined) {
      row.label = dto.label;
    }
    if (dto.description !== undefined) {
      row.description = dto.description;
    }
    if (dto.sortOrder !== undefined) {
      row.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      row.isActive = dto.isActive;
    }
    const saved = await this.nomenclatorRepository.save(row);
    this.revalidationService.notify(NOMENCLATOR_REVALIDATE_TAGS);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.getOne(id);
    await this.nomenclatorRepository.softDelete(id);
    this.revalidationService.notify(NOMENCLATOR_REVALIDATE_TAGS);
  }

  // Same contract as the taxonomy/CMS slug helpers: derive from the label,
  // suffix -2, -3… until unique within the category; a slot held by a
  // soft-deleted leftover is reclaimed (renamed with a timestamp) so retired
  // codes never block recreating an option.
  private async ensureUniqueCode(
    category: string,
    source: string,
  ): Promise<string> {
    const base = slugify(source);
    let candidate = base;
    let suffix = 2;
    for (;;) {
      const clash = await this.nomenclatorRepository.findOne({
        where: { category, code: candidate },
        withDeleted: true,
      });
      if (!clash) {
        return candidate;
      }
      if (clash.deletedAt) {
        await this.nomenclatorRepository.update(clash.id, {
          code: `${clash.code}-eliminado-${Date.now()}`,
        });
        return candidate;
      }
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
}
