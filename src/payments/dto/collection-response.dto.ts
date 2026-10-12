import type { EstadoDeCobro, OrigenDelCobro } from './collections-query.dto';

/** Una línea de la pantalla de cobros: un pedido con actividad de pago. */
export class CollectionRowDto {
  orderId: string;
  orderNumber: string | null;
  /** Para enlazar a la ficha del cliente; null en un pedido sin cliente. */
  clientId: string | null;
  clientName: string | null;
  /** Cuándo entró el dinero. Si no hay fecha de pago, la del pedido. */
  date: Date;
  /** Importe del pedido, en USD. */
  amount: string;
  /** Código del método, del cobro si lo hay y del pedido si no. */
  method: string | null;
  status: EstadoDeCobro;
  origin: OrigenDelCobro;
  /**
   * El pedido está pagado y **no hay ningún cobro con éxito detrás**.
   *
   * No es lo mismo que `origin: 'manual'`: un método manual bien registrado
   * deja su fila. Esto marca el descuadre — alguien lo dio por cobrado y no
   * quedó registro—, que es lo que la tarjeta pide poder ver.
   */
  unreconciled: boolean;
  /** Referencia de la pasarela, cuando la hay. */
  reference: string | null;
}

export class CollectionTotalsDto {
  /** Suma de lo cobrado en el periodo filtrado, no solo de la página. */
  collected: string;
  pending: string;
  refunded: string;
  /** Cuántas filas cobradas no tienen cobro registrado detrás. */
  unreconciledCount: number;
  unreconciledAmount: string;
}

export class CollectionsResponseDto {
  rows: CollectionRowDto[];
  totals: CollectionTotalsDto;
  total: number;
  page: number;
  limit: number;
}
