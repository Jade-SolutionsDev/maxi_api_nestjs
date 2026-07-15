import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CUBA_GEOGRAPHY } from './data/cuba-geography';
import { Municipality } from './entities/municipality.entity';
import { Province } from './entities/province.entity';

@Injectable()
export class GeographyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeographyService.name);

  constructor(
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
    @InjectRepository(Municipality)
    private readonly municipalityRepository: Repository<Municipality>,
  ) {}

  // Idempotent seed of the Cuban administrative division, run once the schema is
  // in place. Safe to run on every boot: existing rows (matched by code) are skipped.
  async onApplicationBootstrap(): Promise<void> {
    let createdProvinces = 0;
    let createdMunicipalities = 0;

    for (const provinceSeed of CUBA_GEOGRAPHY) {
      let province = await this.provinceRepository.findOne({
        where: { code: provinceSeed.code },
      });
      if (!province) {
        province = await this.provinceRepository.save(
          this.provinceRepository.create({
            name: provinceSeed.name,
            code: provinceSeed.code,
          }),
        );
        createdProvinces += 1;
      }

      for (let i = 0; i < provinceSeed.municipalities.length; i += 1) {
        const code = `${provinceSeed.code}-${String(i + 1).padStart(2, '0')}`;
        const existing = await this.municipalityRepository.findOne({
          where: { code },
        });
        if (!existing) {
          await this.municipalityRepository.save(
            this.municipalityRepository.create({
              provinceId: province.id,
              name: provinceSeed.municipalities[i],
              code,
            }),
          );
          createdMunicipalities += 1;
        }
      }
    }

    if (createdProvinces || createdMunicipalities) {
      this.logger.log(
        `Geography seed: ${createdProvinces} provinces, ${createdMunicipalities} municipalities created.`,
      );
    }
  }

  listProvinces(): Promise<Province[]> {
    return this.provinceRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
  }

  listMunicipalities(provinceId?: string): Promise<Municipality[]> {
    return this.municipalityRepository.find({
      where: { isActive: true, ...(provinceId ? { provinceId } : {}) },
      order: { name: 'ASC' },
    });
  }

  async getProvinceOrThrow(id: string): Promise<Province> {
    const province = await this.provinceRepository.findOne({ where: { id } });
    if (!province) {
      throw new NotFoundException(`Province with id "${id}" not found`);
    }
    return province;
  }

  async getMunicipalityOrThrow(id: string): Promise<Municipality> {
    const municipality = await this.municipalityRepository.findOne({
      where: { id },
    });
    if (!municipality) {
      throw new NotFoundException(`Municipality with id "${id}" not found`);
    }
    return municipality;
  }
}
