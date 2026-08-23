import { Order, OrderStatus, PaymentStatus } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { PaymentChargeResponseDto } from '../../payments/dto/payment-charge-response.dto';
import { OrderPaymentMethodDto } from '../../payments/dto/payment-method-response.dto';

export class OrderItemResponseDto {
  productId: string;
  /** Name at checkout time (snapshot — later catalog edits don't change it). */
  name: string;
  /** Live catalog image (null if the product was removed). */
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;

  static fromEntity(item: OrderItem): OrderItemResponseDto {
    const dto = new OrderItemResponseDto();
    dto.productId = item.productId;
    dto.name = item.productNameSnapshot;
    dto.imageUrl = item.product?.imageUrl ?? null;
    dto.quantity = item.quantity;
    dto.unitPrice = Number(item.unitPrice);
    dto.lineTotal = Number(item.lineTotal);
    return dto;
  }
}

export class OrderResponseDto {
  id: string;
  orderNumber: string | null;
  clientId: string;
  // Denormalized so the admin list needs no /clients lookups (GROCER can't
  // read that resource).
  clientName: string | null;
  clientEmail: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryMunicipalityId: string | null;
  deliveryAddress: Record<string, unknown> | null;
  customerNotes: string | null;
  /** Present on detail responses; omitted on lists. */
  items?: OrderItemResponseDto[];
  /**
   * Latest payment attempt, whatever the gateway: a hosted-checkout
   * `redirectUrl`, crypto deposit instructions, or a manual placeholder.
   * Present on detail responses; absent when no attempt was ever created.
   */
  payment?: PaymentChargeResponseDto;
  /**
   * Gateway the latest attempt used, named for display. Present on lists too,
   * where the full attempt would be far too much to carry per row.
   */
  paymentMethod?: OrderPaymentMethodDto;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(order: Order): OrderResponseDto {
    const dto = new OrderResponseDto();
    dto.id = order.id;
    dto.orderNumber = order.orderNumber;
    dto.clientId = order.clientId;
    const client = order.client;
    dto.clientName = client
      ? [client.firstName, client.lastName].filter(Boolean).join(' ') || null
      : null;
    dto.clientEmail = client?.email ?? null;
    dto.status = order.status;
    dto.paymentStatus = order.paymentStatus;
    dto.subtotal = Number(order.subtotal);
    dto.deliveryFee = Number(order.deliveryFee);
    dto.total = Number(order.total);
    dto.deliveryMunicipalityId = order.deliveryMunicipalityId;
    dto.deliveryAddress = order.deliveryAddress;
    dto.customerNotes = order.customerNotes;
    dto.items = order.items?.map(OrderItemResponseDto.fromEntity);
    dto.createdAt = order.createdAt;
    dto.updatedAt = order.updatedAt;
    return dto;
  }
}
