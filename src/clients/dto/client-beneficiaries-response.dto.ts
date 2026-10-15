/** Una persona a la que este cliente le ha mandado pedidos. */
export class BeneficiaryDto {
  /** Como se escribió al comprar. No se normaliza: es lo que puso el cliente. */
  name: string;
  /** Carné, cuando el pedido lo guardó. Los más viejos pueden no traerlo. */
  idCard: string | null;
  phone: string | null;
  /** Cuántos pedidos ha recibido esta persona. */
  timesReceived: number;
  /** Fecha del último pedido que recibió. */
  lastOrderAt: Date;
  /**
   * El teléfono coincide con el del cliente.
   *
   * No dice «es el propio cliente», dice lo que se puede medir. El cliente no
   * guarda carné, y su nombre viene de Clerk mientras el del beneficiario se
   * escribe a mano en el checkout, así que comparar nombres no es fiable:
   * medido en staging, de 56 líneas **ninguna** coincidía por nombre y 10 por
   * teléfono. Se devuelve el hecho y que lo interprete quien lo lee.
   */
  samePhoneAsClient: boolean;
}

export class ClientBeneficiariesResponseDto {
  beneficiaries: BeneficiaryDto[];
  /**
   * Pedidos de este cliente que no guardan a quién se entregaba.
   *
   * Los anteriores a `MxH-0104` no tienen `contactSnapshot`, así que esta lista
   * cubre menos pedidos que su historial. Sin este número la pantalla parecería
   * incompleta sin explicar por qué: en staging, 132 de 188 pedidos no lo
   * tienen.
   */
  ordersWithoutRecipient: number;
}
