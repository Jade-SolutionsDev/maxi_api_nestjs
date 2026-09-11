import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentMethodResponseDto,
  StorefrontPaymentMethodDto,
} from './dto/payment-method-response.dto';
import {
  assertInstructions,
  CreatePaymentMethodDto,
  PaymentInstructionsDto,
} from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import {
  PaymentInstructions,
  PaymentMethod,
} from './entities/payment-method.entity';
import { CustomManualGateway } from './gateways/custom-manual/custom-manual.gateway';
import { PAYMENT_GATEWAYS, PaymentGateway } from './payment-gateway.interface';

/** Icono por defecto según el tipo de instrucción. */
const ICON_BY_TYPE: Record<string, string> = {
  bank: 'Landmark',
  qr: 'QrCode',
  link: 'Link',
  crypto: 'Bitcoin',
};

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Una pasarela y la fila de catálogo que la eligió. */
export interface ResolvedPaymentMethod {
  gateway: PaymentGateway;
  method: PaymentMethod;
}

/** Presentation defaults for a gateway's first appearance in the catalog. */
const SEED: Record<
  string,
  { label: string; description: string; icon: string; sortOrder: number }
> = {
  tropipay: {
    label: 'Tarjeta (Tropipay)',
    description:
      'Paga con tarjeta de crédito o débito en la pasarela segura de Tropipay.',
    icon: 'CreditCard',
    sortOrder: 10,
  },
  mibilletera: {
    label: 'Mi Billetera — Criptomonedas',
    description:
      'Envía USDT a la dirección que te damos; te confirmamos al recibirlo.',
    icon: 'Bitcoin',
    sortOrder: 20,
  },
  'mibilletera-wallet': {
    label: 'Mi Billetera — Saldo',
    description: 'Paga desde tu app de Mi Billetera con el saldo de tu cuenta.',
    icon: 'Wallet',
    sortOrder: 30,
  },
  manual: {
    label: 'Pago manual',
    description: 'Coordinamos el pago contigo y lo confirmamos manualmente.',
    icon: 'HandCoins',
    sortOrder: 90,
  },
};

/**
 * The admin-facing catalog of payment platforms. Rows are created from the
 * registered gateways on boot so a new gateway needs no seed script, but the
 * admin owns them from then on — a boot never re-enables or relabels a row.
 */
@Injectable()
export class PaymentMethodsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly customManualGateway: CustomManualGateway,
    @InjectRepository(PaymentMethod)
    private readonly methodRepository: Repository<PaymentMethod>,
    @Inject(PAYMENT_GATEWAYS)
    private readonly gateways: PaymentGateway[],
  ) {}

  async onModuleInit(): Promise<void> {
    for (const gateway of this.gateways) {
      const exists = await this.methodRepository.findOne({
        where: { code: gateway.code },
      });
      if (exists) continue;

      const seed = SEED[gateway.code] ?? {
        label: gateway.code,
        description: '',
        icon: 'CreditCard',
        sortOrder: 50,
      };
      // manual is the fallback everyone always has; the rest wait for an admin.
      await this.methodRepository.save(
        this.methodRepository.create({
          code: gateway.code,
          ...seed,
          enabled: gateway.code === 'manual',
        }),
      );
      this.logger.log(`Registered payment method "${gateway.code}"`);
    }
  }

  /** code -> display label, for rows that only need to name the method. */
  async labelsByCode(): Promise<Map<string, string>> {
    const methods = await this.methodRepository.find();
    return new Map(methods.map((method) => [method.code, method.label]));
  }

  /**
   * La pasarela que atiende un código. Un código sin clase registrada es un
   * método que creó el admin, así que cae en la manual personalizada en vez de
   * reventar: `resolve()` ya valida contra la base antes de cobrar, y los demás
   * llamantes traen el `provider` de un cobro que fue válido al crearse — así
   * un método ya borrado sigue mostrando sus pedidos viejos.
   */
  gatewayFor(code: string): PaymentGateway {
    return (
      this.gateways.find((g) => g.code === code) ?? this.customManualGateway
    );
  }

  // ---------------- Admin ----------------

  async findAll(): Promise<PaymentMethodResponseDto[]> {
    const methods = await this.methodRepository.find({
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    return methods.map((method) => {
      const gateway = this.gatewayFor(method.code);
      return PaymentMethodResponseDto.fromEntity(
        method,
        gateway.configured,
        gateway.kind,
      );
    });
  }

  async update(
    id: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    const method = await this.methodRepository.findOne({ where: { id } });
    if (!method) {
      throw new NotFoundException(`Payment method with id "${id}" not found`);
    }
    const gateway = this.gatewayFor(method.code);
    // Enabling a gateway whose credentials are missing would only produce
    // failed checkouts, so it is refused up front.
    if (dto.enabled && !gateway.configured) {
      throw new BadRequestException(
        `"${method.code}" has no credentials configured in this environment`,
      );
    }
    // Only what the caller actually sent: a validated DTO instance carries
    // every optional field as `undefined`, and copying those blanks the entity
    // in memory (TypeORM skips them on save, but the response would lie).
    Object.assign(
      method,
      Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    );
    await this.methodRepository.save(method);
    return PaymentMethodResponseDto.fromEntity(
      method,
      gateway.configured,
      gateway.kind,
    );
  }

  /**
   * Un método que define el admin. El código sale de la etiqueta y no puede
   * chocar con una pasarela del código: si lo hiciera, `gatewayFor` devolvería
   * la clase registrada y las instrucciones no se mostrarían nunca.
   */
  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethodResponseDto> {
    const code = await this.uniqueCodeFor(dto.label);
    const instructions = this.validInstructions(dto.instructions);

    const method = await this.methodRepository.save(
      this.methodRepository.create({
        code,
        label: dto.label,
        description: dto.description ?? null,
        icon: dto.icon ?? ICON_BY_TYPE[instructions.type],
        sortOrder: dto.sortOrder ?? 50,
        enabled: dto.enabled ?? false,
        isCustom: true,
        instructions,
      }),
    );
    return PaymentMethodResponseDto.fromEntity(method, true, 'manual');
  }

  /** Sólo lo que creó un admin: una pasarela del código se apaga, no se borra. */
  async remove(id: string): Promise<void> {
    const method = await this.methodRepository.findOne({ where: { id } });
    if (!method) {
      throw new NotFoundException(`Payment method with id "${id}" not found`);
    }
    if (!method.isCustom) {
      throw new BadRequestException(
        'Una pasarela integrada no se borra; desactívala.',
      );
    }
    await this.methodRepository.softDelete(id);
  }

  /** Traduce el fallo de contrato del tipo en un 400 legible. */
  private validInstructions(dto: PaymentInstructionsDto): PaymentInstructions {
    try {
      return assertInstructions(dto);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Instrucciones inválidas',
      );
    }
  }

  private async uniqueCodeFor(label: string): Promise<string> {
    const base =
      slugify(label).slice(0, 28) || `metodo-${Date.now().toString(36)}`;

    if (this.gateways.some((gateway) => gateway.code === base)) {
      throw new BadRequestException(
        `"${label}" choca con una pasarela integrada; usa otro nombre.`,
      );
    }

    let code = base;
    let suffix = 2;
    while (
      await this.methodRepository.findOne({
        where: { code },
        withDeleted: true,
      })
    ) {
      code = `${base}-${suffix++}`;
    }
    return code;
  }

  // ---------------- Storefront ----------------

  /** Methods a customer may actually pick: enabled AND configured. */
  async findAvailable(): Promise<PaymentMethod[]> {
    const methods = await this.methodRepository.find({
      where: { enabled: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    return methods.filter((method) => this.gatewayFor(method.code).configured);
  }

  async findAvailableForStorefront(): Promise<StorefrontPaymentMethodDto[]> {
    const methods = await this.findAvailable();
    return methods.map((method) =>
      StorefrontPaymentMethodDto.fromEntity(
        method,
        this.gatewayFor(method.code).kind,
      ),
    );
  }

  /**
   * Resolve the method for a payment attempt: the requested one when it is
   * available, otherwise the first available one. Falls back to `manual` so a
   * checkout never dies because every gateway is off.
   *
   * Devuelve también la fila: una sola pasarela manual sirve a todos los
   * métodos personalizados, así que el cobro necesita saber cuál se eligió
   * para guardar su código y copiar sus instrucciones.
   */
  async resolve(requested?: string): Promise<ResolvedPaymentMethod> {
    const available = await this.findAvailable();
    if (requested) {
      const match = available.find((method) => method.code === requested);
      if (!match) {
        throw new BadRequestException(
          `Payment method "${requested}" is not available`,
        );
      }
      return { gateway: this.gatewayFor(match.code), method: match };
    }

    const fallback =
      available[0] ??
      (await this.methodRepository.findOne({ where: { code: 'manual' } }));
    if (!fallback) {
      throw new NotFoundException('No hay ningún método de pago disponible');
    }
    return { gateway: this.gatewayFor(fallback.code), method: fallback };
  }
}
