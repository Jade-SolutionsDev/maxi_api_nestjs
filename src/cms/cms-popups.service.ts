import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import {
  CmsPopupResponseDto,
  CreateCmsPopupDto,
  PublicCmsPopupDto,
  UpdateCmsPopupDto,
} from './dto/cms-popup.dto';
import { CmsPopup } from './entities/cms-popup.entity';

@Injectable()
export class CmsPopupsService {
  constructor(
    @InjectRepository(CmsPopup)
    private readonly popupRepository: Repository<CmsPopup>,
    private readonly revalidationService: RevalidationService,
  ) {}

  async list(): Promise<CmsPopupResponseDto[]> {
    const popups = await this.popupRepository.find({
      order: { publishedAt: 'DESC', createdAt: 'DESC' },
    });
    const now = new Date();
    return popups.map((p) => CmsPopupResponseDto.fromEntity(p, now));
  }

  async findOne(id: string): Promise<CmsPopupResponseDto> {
    return CmsPopupResponseDto.fromEntity(await this.getOrThrow(id));
  }

  async create(
    dto: CreateCmsPopupDto,
    userId: string,
  ): Promise<CmsPopupResponseDto> {
    const popup = this.popupRepository.create({
      ...this.camposDe(dto),
      title: dto.title,
      body: dto.body,
      isActive: dto.isActive ?? true,
      createdBy: userId,
      updatedBy: userId,
      // Nace borrador siempre: publicar es un acto aparte y deliberado.
      publishedAt: null,
    });
    this.assertImagenesCompletas(popup);
    const guardado = await this.popupRepository.save(popup);
    return CmsPopupResponseDto.fromEntity(guardado);
  }

  async update(
    id: string,
    dto: UpdateCmsPopupDto,
    userId: string,
  ): Promise<CmsPopupResponseDto> {
    const popup = await this.getOrThrow(id);
    Object.assign(popup, this.camposDe(dto));
    if (dto.title !== undefined) popup.title = dto.title;
    if (dto.body !== undefined) popup.body = dto.body;
    if (dto.isActive !== undefined) popup.isActive = dto.isActive;
    popup.updatedBy = userId;

    this.assertImagenesCompletas(popup);
    if (popup.publishedAt) await this.assertNoSeSolapa(popup);

    const guardado = await this.popupRepository.save(popup);
    // Editar algo ya publicado cambia lo que ve la tienda.
    if (guardado.publishedAt)
      this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return CmsPopupResponseDto.fromEntity(guardado);
  }

  /**
   * Publicar es lo que saca el aviso de la administración.
   *
   * Aquí se comprueba que no haya **dos vigentes a la vez**: dos ventanas
   * peleándose por la misma pantalla es un fallo que el cliente ve y nadie
   * prueba. Se mira al publicar y al editar lo ya publicado, que son los dos
   * momentos en que puede nacer el solape.
   */
  async publish(id: string, userId: string): Promise<CmsPopupResponseDto> {
    const popup = await this.getOrThrow(id);
    if (popup.publishedAt) {
      throw new ConflictException('Este aviso ya está publicado');
    }
    popup.publishedAt = new Date();
    popup.updatedBy = userId;
    await this.assertNoSeSolapa(popup);

    const guardado = await this.popupRepository.save(popup);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return CmsPopupResponseDto.fromEntity(guardado);
  }

  /** Lo retira de la tienda sin borrarlo: vuelve a ser un borrador. */
  async unpublish(id: string, userId: string): Promise<CmsPopupResponseDto> {
    const popup = await this.getOrThrow(id);
    if (!popup.publishedAt) {
      throw new ConflictException('Este aviso no está publicado');
    }
    popup.publishedAt = null;
    popup.updatedBy = userId;
    const guardado = await this.popupRepository.save(popup);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return CmsPopupResponseDto.fromEntity(guardado);
  }

  async remove(id: string): Promise<void> {
    const popup = await this.getOrThrow(id);
    await this.popupRepository.softDelete(popup.id);
    if (popup.publishedAt) this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }

  /**
   * El aviso que toca enseñar ahora, o `null`. Lo pide la tienda en cada
   * visita, así que no devuelve nada que no vaya a pintarse: publicado,
   * activo y dentro de fechas.
   */
  async vigente(now: Date = new Date()): Promise<PublicCmsPopupDto | null> {
    const candidatos = await this.popupRepository.find({
      where: { isActive: true, publishedAt: Not(IsNull()) },
      order: { publishedAt: 'DESC' },
    });
    const vigente = candidatos.find((p) => this.estaVigente(p, now));
    return vigente ? PublicCmsPopupDto.fromEntity(vigente) : null;
  }

  // ---------------- Internos ----------------

  private async getOrThrow(id: string): Promise<CmsPopup> {
    const popup = await this.popupRepository.findOne({ where: { id } });
    if (!popup) {
      throw new NotFoundException(`No hay ningún aviso con el id "${id}"`);
    }
    return popup;
  }

  private camposDe(dto: CreateCmsPopupDto | UpdateCmsPopupDto) {
    const fecha = (valor?: string | null) =>
      valor === undefined ? undefined : valor === null ? null : new Date(valor);
    return {
      buttonLabel: dto.buttonLabel,
      buttonHref: dto.buttonHref,
      desktop: dto.desktop ?? null,
      tablet: dto.tablet ?? null,
      mobile: dto.mobile ?? null,
      startsAt: fecha(dto.startsAt),
      endsAt: fecha(dto.endsAt),
      repeatAfterHours: dto.repeatAfterHours,
    };
  }

  /** O las tres medidas o ninguna: media portada rota se ve en el teléfono. */
  private assertImagenesCompletas(popup: CmsPopup): void {
    const puestas = [popup.desktop, popup.tablet, popup.mobile].filter(Boolean);
    if (puestas.length !== 0 && puestas.length !== 3) {
      throw new BadRequestException(
        'La imagen va en las tres medidas —escritorio, tableta y teléfono— o en ninguna',
      );
    }
    if (popup.buttonHref && !popup.buttonLabel) {
      throw new BadRequestException(
        'Un enlace sin texto de botón no se puede pulsar: ponle texto al botón',
      );
    }
  }

  private estaVigente(popup: CmsPopup, now: Date): boolean {
    if (!popup.publishedAt || !popup.isActive) return false;
    if (popup.startsAt && popup.startsAt > now) return false;
    if (popup.endsAt && popup.endsAt <= now) return false;
    return true;
  }

  private async assertNoSeSolapa(popup: CmsPopup): Promise<void> {
    const otros = await this.popupRepository.find({
      where: { isActive: true, publishedAt: Not(IsNull()) },
    });
    const choca = otros.find(
      (otro) => otro.id !== popup.id && this.seSolapan(popup, otro),
    );
    if (choca) {
      throw new ConflictException(
        `«${choca.title}» ya está publicado para esas fechas. Retíralo o cambia las fechas: solo puede verse un aviso a la vez.`,
      );
    }
  }

  /** Dos tramos con extremos abiertos se solapan salvo que uno acabe antes. */
  private seSolapan(a: CmsPopup, b: CmsPopup): boolean {
    const desdeA = a.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const hastaA = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const desdeB = b.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const hastaB = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return desdeA < hastaB && desdeB < hastaA;
  }
}
