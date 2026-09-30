import { MigrationInterface, QueryRunner } from 'typeorm';

const FAQ_OLD = `Sí, en nuestro local de Cárdenas.

El orden importa: este servicio es únicamente para clientes de la tienda online, así que primero haz tu pedido en la web. Una vez lo tengas con su número, te acercas al local y lo pagas allí.`;

const FAQ_NEW = `${FAQ_OLD}

El pedido no caduca automáticamente: permanece pendiente hasta que lo pagues en el local o nuestro equipo lo cancele de forma explícita.`;

const TERMS_OLD = `### 5.1 Plazo para pagar

La mercancía reservada no puede quedar apartada indefinidamente: mientras tu
pedido espera el pago, esos productos no están disponibles para nadie más.

Por eso, un pedido sin pagar **caduca**:

- **Pago por pasarela en línea:** 30 minutos, contados desde tu último intento
  de pago.

Cuando un pedido caduca, se cancela automáticamente y la mercancía vuelve al
catálogo. Puedes volver a hacer el pedido, sujeto a la disponibilidad de ese
momento.

Los plazos vigentes se te indican durante el proceso de pago; esa indicación es
la que manda.`;

const TERMS_NEW = `### 5.1 Plazo para pagar

El plazo depende de la forma de pago elegida:

- **Pago por pasarela en línea:** 30 minutos, contados desde tu último intento
  de pago. Cuando vence, el pedido se cancela automáticamente y la mercancía
  vuelve al catálogo.
- **Pago en efectivo en el local:** no caduca automáticamente. El pedido
  permanece pendiente hasta que lo pagues de forma presencial o nuestro equipo
  lo cancele de forma explícita.

Los plazos vigentes se te indican durante el proceso de pago; esa indicación es
la que manda.`;

/**
 * Alinea las dos piezas editoriales que la tienda sirve desde el CMS con la
 * regla de negocio: el efectivo presencial no vence solo.
 *
 * Los UPDATE están protegidos por el texto anterior exacto observado en el
 * endpoint público de producción. Así se conserva cualquier edición posterior
 * y la migración es inocua en entornos sin ese contenido (la siembra no crea
 * estas filas). No se introduce una copia estática en la tienda.
 */
export class CashPaymentContent1789800000000 implements MigrationInterface {
  name = 'CashPaymentContent1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "cms_faq_questions"
          SET answer = $2,
              updated_at = now()
        WHERE question = '¿Puedo pagar en efectivo?'
          AND answer = $1
          AND deleted_at IS NULL`,
      [FAQ_OLD, FAQ_NEW],
    );

    await queryRunner.query(
      `UPDATE "cms_pages"
          SET content = replace(content, $1, $2),
              updated_at = now()
        WHERE slug = 'terminos-y-condiciones'
          AND deleted_at IS NULL
          AND position($1 in content) > 0`,
      [TERMS_OLD, TERMS_NEW],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "cms_faq_questions"
          SET answer = $2,
              updated_at = now()
        WHERE question = '¿Puedo pagar en efectivo?'
          AND answer = $1
          AND deleted_at IS NULL`,
      [FAQ_NEW, FAQ_OLD],
    );

    await queryRunner.query(
      `UPDATE "cms_pages"
          SET content = replace(content, $1, $2),
              updated_at = now()
        WHERE slug = 'terminos-y-condiciones'
          AND deleted_at IS NULL
          AND position($1 in content) > 0`,
      [TERMS_NEW, TERMS_OLD],
    );
  }
}
