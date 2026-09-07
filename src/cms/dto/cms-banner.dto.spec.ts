import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CmsBannerTargetType } from '../cms-banner.types';
import {
  CmsBannerResponseDto,
  CreateCmsBannerDto,
  PublicCmsBannerResponseDto,
  UpdateCmsBannerDto,
} from './cms-banner.dto';
import type { CmsBannerView } from '../cms-banner.types';
import type { CmsBanner } from '../entities/cms-banner.entity';

const input = {
  alt: 'Oferta semanal',
  desktop: { src: '/desktop.webp', width: 1600, height: 500 },
  tablet: { src: '/tablet.webp', width: 1024, height: 420 },
  mobile: { src: '/mobile.webp', width: 640, height: 480 },
};

const banner = {
  id: '11111111-1111-4111-8111-111111111111',
  ...input,
  targetType: CmsBannerTargetType.PRODUCT,
  targetId: '33333333-3333-4333-8333-333333333333',
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  deletedAt: null,
} as CmsBanner;

describe('CMS banner DTOs', () => {
  it('accepts a typed UUID target and rejects an unsupported target type', async () => {
    const valid = plainToInstance(CreateCmsBannerDto, {
      ...input,
      target: {
        type: CmsBannerTargetType.PRODUCT,
        id: '33333333-3333-4333-8333-333333333333',
      },
    });
    const invalid = plainToInstance(CreateCmsBannerDto, {
      ...input,
      target: {
        type: 'external',
        id: '33333333-3333-4333-8333-333333333333',
      },
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'target' })]),
    );
  });

  it('rejects a malformed target UUID and allows null to clear it', async () => {
    const malformed = plainToInstance(UpdateCmsBannerDto, {
      target: { type: CmsBannerTargetType.CATEGORY, id: 'not-a-uuid' },
    });
    const clear = plainToInstance(UpdateCmsBannerDto, { target: null });

    await expect(validate(malformed)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'target' })]),
    );
    await expect(validate(clear)).resolves.toHaveLength(0);
  });

  it('keeps unavailable target details for admin but removes the public link', () => {
    const view: CmsBannerView = {
      banner,
      target: {
        type: CmsBannerTargetType.PRODUCT,
        id: banner.targetId!,
        name: 'Arroz',
        slug: 'arroz',
        isAvailable: false,
      },
    };

    expect(CmsBannerResponseDto.fromView(view).target).toEqual(view.target);
    expect(PublicCmsBannerResponseDto.fromView(view).target).toBeNull();
  });

  it('publishes the current slug for an available target', () => {
    const view: CmsBannerView = {
      banner,
      target: {
        type: CmsBannerTargetType.PRODUCT,
        id: banner.targetId!,
        name: 'Arroz',
        slug: 'arroz-selecto',
        isAvailable: true,
      },
    };

    expect(PublicCmsBannerResponseDto.fromView(view).target).toEqual({
      type: CmsBannerTargetType.PRODUCT,
      id: banner.targetId,
      slug: 'arroz-selecto',
    });
  });
});
