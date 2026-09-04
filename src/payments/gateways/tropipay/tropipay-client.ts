import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type PaymentLink,
  type PaymentLinkPayload,
  ServerSideUtils,
  Tropipay,
} from '@yosle/tropipayjs';
import { PaymentsConfig, TropipayConfig } from '../../../config/configuration';

/** One account movement, reduced to what payment confirmation needs. */
export interface TropipayMovement {
  reference?: string;
  state?: number;
  completedAt?: string | null;
  bankOrderCode?: string;
  amount?: number;
  originalCurrencyAmount?: string | number;
  [key: string]: unknown;
}

/**
 * Thin wrapper around the Tropipay SDK: one lazily-built instance (the SDK
 * caches the OAuth token statically and refreshes it on expiry), plus the
 * signature check. Everything payment-shaped lives in TropipayGateway.
 */
@Injectable()
export class TropipayClient implements OnModuleInit {
  private readonly logger = new Logger(TropipayClient.name);
  private instance: Tropipay | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Warm the OAuth token in the background. The login round-trip costs seconds
   * against the gateway and the SDK caches the token, so paying it at boot
   * keeps it off the first customer's checkout. Never awaited and never fatal:
   * an unreachable gateway must not hold up or break startup.
   */
  onModuleInit(): void {
    if (!this.config.configured) return;

    void this.sdk
      .login()
      .catch((err: unknown) =>
        this.logger.warn(
          `Could not pre-authenticate with Tropipay: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }

  get config(): TropipayConfig {
    return this.configService.get<PaymentsConfig>('payments')!.tropipay;
  }

  private get sdk(): Tropipay {
    if (!this.config.configured) {
      throw new Error('Tropipay is not configured');
    }
    this.instance ??= new Tropipay({
      clientId: this.config.clientId as string,
      clientSecret: this.config.clientSecret as string,
      serverMode: this.config.serverMode,
      scopes: [
        'ALLOW_GET_PROFILE_DATA',
        'ALLOW_PAYMENT_IN',
        'ALLOW_EXTERNAL_CHARGE',
        'ALLOW_GET_BALANCE',
        'ALLOW_GET_MOVEMENT_LIST',
      ],
    });
    return this.instance;
  }

  async createPaymentLink(payload: PaymentLinkPayload): Promise<PaymentLink> {
    try {
      return await this.sdk.paymentCards.create(payload);
    } catch (err) {
      // The top-level message is always "Invalid Parameter"; `details` is the
      // only place the rejected field appears.
      const details = (err as { error?: { details?: unknown } })?.error
        ?.details;
      this.logger.error(
        `Tropipay payment link rejected: ${(err as Error).message}`,
        details ? JSON.stringify(details) : undefined,
      );
      throw err;
    }
  }

  /**
   * Recent account movements. There is no "get transaction by reference"
   * endpoint, so confirmation scans a recent page for our own reference.
   */
  async findMovementByReference(
    reference: string,
  ): Promise<TropipayMovement | undefined> {
    const result = (await this.sdk.movements(0, 50)) as
      TropipayMovement[] | { rows?: TropipayMovement[] };
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    return rows.find((row) => row.reference === reference);
  }

  verifySignature(
    originalCurrencyAmount: string,
    bankOrderCode: string,
    signature: string,
  ): boolean {
    return ServerSideUtils.verifySignature(
      {
        clientId: this.config.clientId as string,
        clientSecret: this.config.clientSecret as string,
      },
      originalCurrencyAmount,
      bankOrderCode,
      signature,
    );
  }
}
