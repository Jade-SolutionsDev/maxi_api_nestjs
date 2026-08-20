import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsConfig } from '../../../config/configuration';

// Shape of `data` for merchant charges (create + get share it). Only the
// fields we consume are typed; the full body is persisted as jsonb anyway.
export interface MibiChargeData {
  charge_id: string;
  reference: string;
  method: string;
  amount: string;
  fee_amount?: string;
  net_amount?: string;
  settlement_amount?: string;
  currency: string;
  status: string;
  description?: string;
  action_payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  underlying_reference?: string;
  error_message?: string;
  expires_at?: string | null;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface CreateChargeBody {
  method: 'CRYPTO';
  amount: string;
  currency: string;
  description?: string;
  idempotency_key: string;
  metadata?: Record<string, string>;
}

interface MibiEnvelope {
  success: boolean;
  message?: string;
  error_code?: string;
  errors?: Record<string, string[]>;
  data?: MibiChargeData;
}

/** Gateway failure with the stable error_code the doc says to branch on. */
export class MibiApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'MibiApiError';
  }
}

// Thin transport wrapper over the Mi Billetera merchant-charges API. Global
// fetch (Node 22) — no HTTP dependency. No retries here: checkout tolerates a
// failed initiation and the customer retries via POST .../payment.
@Injectable()
export class MibiClient {
  private readonly logger = new Logger(MibiClient.name);

  constructor(private readonly configService: ConfigService) {}

  createCharge(body: CreateChargeBody): Promise<MibiChargeData> {
    return this.request('POST', '/api/merchant/charges/', body);
  }

  getCharge(reference: string): Promise<MibiChargeData> {
    return this.request(
      'GET',
      `/api/merchant/charges/${encodeURIComponent(reference)}/`,
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<MibiChargeData> {
    const mibi = this.configService.get<PaymentsConfig>('payments')?.mibi;
    if (!mibi?.configured) {
      throw new MibiApiError('Mi Billetera is not configured', 0);
    }

    let response: Response;
    try {
      response = await fetch(`${mibi.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key-Id': mibi.keyId as string,
          'X-API-Key-Secret': mibi.secretKey as string,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(
        `Mi Billetera unreachable: ${method} ${path}`,
        err instanceof Error ? err.message : String(err),
      );
      throw new MibiApiError('Mi Billetera is unreachable', 0);
    }

    const envelope = (await response
      .json()
      .catch(() => null)) as MibiEnvelope | null;
    if (!response.ok || !envelope?.success || !envelope.data) {
      // Never log secrets; error_code is the stable branching key.
      this.logger.warn(
        `Mi Billetera ${method} ${path} -> ${response.status} ` +
          `${envelope?.error_code ?? ''} ${envelope?.message ?? ''}`,
      );
      throw new MibiApiError(
        envelope?.message ?? `Mi Billetera request failed (${response.status})`,
        response.status,
        envelope?.error_code,
      );
    }
    return envelope.data;
  }
}
