import { BadRequestException, Injectable } from '@nestjs/common';
import { Order } from '../../../orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
} from '../../entities/payment-charge.entity';
import { PaymentMethod } from '../../entities/payment-method.entity';
import {
  GatewayCharge,
  GatewayWebhookEvent,
  PaymentActionKind,
  PaymentGateway,
} from '../../payment-gateway.interface';

/**
 * Los métodos que define el admin: una cuenta de banco, un QR de Transfermóvil,
 * un enlace fijo, una dirección de cripto. No hay pasarela que contactar — sólo
 * se le enseña al cliente dónde pagar y luego alguien concilia a mano.
 *
 * Una sola instancia sirve a TODAS las filas personalizadas, así que el método
 * elegido llega por parámetro. Las instrucciones se copian dentro del cobro: si
 * mañana cambian la cuenta, el pedido de ayer debe seguir contando dónde se
 * pagó — la misma regla que la dirección de entrega del pedido.
 */
@Injectable()
export class CustomManualGateway extends PaymentGateway {
  readonly code = 'custom-manual';
  readonly kind: PaymentActionKind = 'manual';

  get configured(): boolean {
    return true;
  }

  createCharge(
    order: Order,
    idempotencyKey: string,
    method?: PaymentMethod,
  ): Promise<GatewayCharge> {
    return Promise.resolve({
      reference: idempotencyKey,
      status: ChargeStatus.PENDING,
      amount: Number(order.total).toFixed(2),
      currency: 'USD',
      actionPayload: {
        methodLabel: method?.label ?? null,
        instructions: method?.instructions ?? null,
      },
      rawPayload: { manual: true, method: method?.code ?? null },
    });
  }

  // Nada que preguntar: sólo un admin mueve un cobro manual.
  syncCharge(charge: PaymentCharge): Promise<GatewayCharge> {
    return Promise.resolve({
      reference: charge.reference,
      status: charge.status,
      amount: charge.amount,
      currency: charge.currency,
      actionPayload: charge.actionPayload,
      rawPayload: charge.lastPayload ?? { manual: true },
    });
  }

  parseWebhook(): GatewayWebhookEvent {
    throw new BadRequestException('Los pagos manuales no reciben webhooks');
  }
}
