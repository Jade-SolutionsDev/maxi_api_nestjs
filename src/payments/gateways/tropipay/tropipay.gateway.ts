import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentsConfig,
  StorefrontConfig,
} from '../../../config/configuration';
import { Order } from '../../../orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
} from '../../entities/payment-charge.entity';
import {
  GatewayCharge,
  GatewayWebhookEvent,
  PaymentActionKind,
  PaymentGateway,
} from '../../payment-gateway.interface';
import { TropipayClient } from './tropipay-client';

/** Tropipay rejects anything else with an opaque 400 that never names the field. */
const SUPPORTED_CURRENCIES = ['EUR', 'USD'];

/**
 * Tropipay rejects small charges with the same opaque "Invalid amount" it uses
 * for a malformed one. Measured against the sandbox on 2026-09-01: 1.10 USD is
 * refused, 1.15 accepted — a fee-shaped floor rather than a documented round
 * number, so the real limit may differ per account and in production. Hence a
 * default with margin that ops can lower per environment.
 */
const DEFAULT_MIN_AMOUNT = 1.5;

/** Movement state for a settled incoming payment. */
const MOVEMENT_COMPLETED = 2;

interface TropipayNotification {
  status?: string;
  data?: {
    reference?: string;
    bankOrderCode?: string;
    originalCurrencyAmount?: string | number;
    signaturev2?: string;
    amount?: number;
    currency?: string;
    ourFee?: number;
    errorReason?: string | null;
    [key: string]: unknown;
  };
}

/**
 * Hosted payment links (cards). The customer leaves the site entirely and
 * Tropipay captures the money on its own page, so the signed notification —
 * not the customer's return — is what marks an order paid.
 */
@Injectable()
export class TropipayGateway extends PaymentGateway {
  readonly code = 'tropipay';
  readonly kind: PaymentActionKind = 'redirect';

  private readonly logger = new Logger(TropipayGateway.name);

  constructor(
    private readonly client: TropipayClient,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  get configured(): boolean {
    return this.client.config.configured;
  }

  async createCharge(
    order: Order,
    idempotencyKey: string,
  ): Promise<GatewayCharge> {
    const currency = this.client.config.currency;
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new BadRequestException(
        `Tropipay only settles in ${SUPPORTED_CURRENCIES.join(' or ')} (configured: ${currency})`,
      );
    }

    const total = Number(order.total);
    const minAmount = this.client.config.minAmount ?? DEFAULT_MIN_AMOUNT;
    if (total < minAmount) {
      // Caught here so the customer reads why, instead of the gateway's
      // "Invalid amount" surfacing as a generic payment failure.
      throw new BadRequestException(
        `El monto mínimo para pagar con tarjeta es ${minAmount.toFixed(2)} ${currency}. Elige otra forma de pago para este pedido.`,
      );
    }

    const concept = `Orden ${order.orderNumber ?? order.id}`;
    const link = await this.client.createPaymentLink({
      // The reference is our only handle on the payment: it comes back on the
      // notification and on the movement row.
      reference: idempotencyKey,
      concept,
      description: concept,
      // Minor units — `amount: 3800` is 38.00, not 3800.
      amount: Math.round(Number(order.total) * 100),
      currency,
      singleUse: true,
      favorite: false,
      reasonId: 4,
      // 0 = no refund window, so funds settle immediately. Refunds stay a
      // manual admin action (production refunds need an SMS 2FA code).
      expirationDays: 0,
      lang: 'es',
      serviceDate: new Date().toISOString().slice(0, 10),
      urlSuccess: this.storefrontUrl(order.id, 'ok'),
      urlFailed: this.storefrontUrl(order.id, 'error'),
      urlNotification: this.notificationUrl(),
      // All-or-nothing: a partial client object is a common source of 400s.
      client: null,
      directPayment: true,
    });

    return {
      reference: idempotencyKey,
      // The link exists and is waiting for the customer to go pay it.
      status: ChargeStatus.REQUIRES_ACTION,
      amount: Number(order.total).toFixed(2),
      currency,
      // No action deadline with expirationDays: 0 — the panel shows no countdown.
      expiresAt: null,
      redirectUrl: link.shortUrl ?? link.paymentUrl ?? null,
      rawPayload: link as unknown as Record<string, unknown>,
    };
  }

  /**
   * Fallback confirmation for the moment the customer returns before the
   * notification arrives. Movements LAG the webhook, so this can only ever
   * promote a charge — never downgrade one.
   */
  async syncCharge(charge: PaymentCharge): Promise<GatewayCharge> {
    const movement = await this.client.findMovementByReference(
      charge.reference,
    );
    const paid =
      !!movement &&
      (movement.state === MOVEMENT_COMPLETED || Boolean(movement.completedAt));

    return {
      reference: charge.reference,
      status: paid ? ChargeStatus.SUCCEEDED : charge.status,
      amount: charge.amount,
      currency: charge.currency,
      redirectUrl: charge.redirectUrl,
      completedAt: paid ? new Date() : null,
      rawPayload: movement ?? charge.lastPayload ?? {},
    };
  }

  parseWebhook(rawBody: string): GatewayWebhookEvent {
    let event: TropipayNotification;
    try {
      event = JSON.parse(rawBody) as TropipayNotification;
    } catch {
      throw new BadRequestException('Invalid JSON webhook payload');
    }

    const data = event.data;
    if (!data?.reference || !data.bankOrderCode) {
      throw new BadRequestException('Malformed Tropipay notification');
    }

    // sha256(bankOrderCode + clientId + clientSecret + originalCurrencyAmount)
    const valid = this.client.verifySignature(
      String(data.originalCurrencyAmount),
      String(data.bankOrderCode),
      String(data.signaturev2 ?? ''),
    );
    if (!valid) {
      this.logger.warn(
        `Rejected Tropipay notification for reference "${data.reference}": bad signature`,
      );
      throw new UnauthorizedException('Invalid Tropipay signature');
    }

    // "OK" means paid; "KO" means the payment was attempted and failed.
    const succeeded = event.status === 'OK';
    return {
      reference: data.reference,
      charge: {
        status: succeeded ? ChargeStatus.SUCCEEDED : ChargeStatus.FAILED,
        // Fees come back in minor units, like every other amount.
        feeAmount:
          typeof data.ourFee === 'number'
            ? (data.ourFee / 100).toFixed(2)
            : undefined,
        errorMessage: succeeded ? null : (data.errorReason ?? 'Payment failed'),
        completedAt: new Date(),
        rawPayload: event as unknown as Record<string, unknown>,
      },
    };
  }

  private storefrontUrl(orderId: string, outcome: 'ok' | 'error'): string {
    const base = (
      this.configService.get<StorefrontConfig>('storefront')?.url ??
      'http://127.0.0.1:3001'
    ).replace(/\/+$/, '');
    return normalizeCallbackUrl(`${base}/pedidos/${orderId}?pago=${outcome}`);
  }

  private notificationUrl(): string {
    const base = (
      this.configService.get<PaymentsConfig>('payments')?.publicUrl ??
      'http://127.0.0.1:3000'
    ).replace(/\/+$/, '');
    return normalizeCallbackUrl(`${base}/api/webhooks/payments/tropipay`);
  }
}

/**
 * Tropipay validates callback URLs and rejects the bare hostname `localhost`
 * (but accepts 127.0.0.1, and plain http). Note that 127.0.0.1 only passes
 * *validation* — Tropipay still can't reach it, so a local urlNotification
 * needs a public tunnel.
 */
export const normalizeCallbackUrl = (url: string): string =>
  url.replace(/\/\/localhost(?=[:/?]|$)/, '//127.0.0.1');
