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
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethod } from './entities/payment-method.entity';
import { PAYMENT_GATEWAYS, PaymentGateway } from './payment-gateway.interface';

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
    label: 'Criptomonedas (Mi Billetera)',
    description:
      'Transfiere USDT desde tu billetera; te damos la dirección de depósito.',
    icon: 'Bitcoin',
    sortOrder: 20,
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

  gatewayFor(code: string): PaymentGateway {
    const gateway = this.gateways.find((g) => g.code === code);
    if (!gateway) {
      throw new NotFoundException(`Unknown payment method "${code}"`);
    }
    return gateway;
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
   */
  async resolve(requested?: string): Promise<PaymentGateway> {
    const available = await this.findAvailable();
    if (requested) {
      const match = available.find((method) => method.code === requested);
      if (!match) {
        throw new BadRequestException(
          `Payment method "${requested}" is not available`,
        );
      }
      return this.gatewayFor(match.code);
    }
    return this.gatewayFor(available[0]?.code ?? 'manual');
  }
}
