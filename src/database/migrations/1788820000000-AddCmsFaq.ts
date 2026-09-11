import { MigrationInterface, QueryRunner } from 'typeorm';

type SeedQuestion = {
  id: string;
  categoryId: string;
  question: string;
  answer: string;
  sortOrder: number;
  linkLabel?: string;
  linkHref?: string;
};

const CRYPTO = '11111111-1111-4111-8111-111111111111';
const WALLET = '22222222-2222-4222-8222-222222222222';
const ORDERS = '33333333-3333-4333-8333-333333333333';

const questions: SeedQuestion[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    categoryId: CRYPTO,
    question: '¿Con qué criptomoneda puedo pagar?',
    answer: 'Actualmente, los pagos con criptomonedas se realizan con USDT.',
    sortOrder: 10,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    categoryId: CRYPTO,
    question: '¿Qué red debo utilizar?',
    answer:
      'Envía los USDT únicamente por la red BEP20. La pantalla de pago también mostrará la red que debes usar.',
    sortOrder: 20,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    categoryId: CRYPTO,
    question: '¿Cómo funciona el pago con criptomonedas?',
    answer:
      'Al seleccionar este método y confirmar tu pedido, recibirás una dirección de pago y el importe exacto que debes enviar. Transfiere los USDT a esa dirección usando la red indicada.',
    sortOrder: 30,
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    categoryId: CRYPTO,
    question: '¿Cuánto tiempo tengo para realizar el pago?',
    answer:
      'Tienes 30 minutos para completar el pago. Cuando el tiempo vence, esas instrucciones dejan de ser válidas y podrás generar unas nuevas para reintentar.',
    sortOrder: 40,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    categoryId: CRYPTO,
    question: '¿Tengo que enviar el importe exacto?',
    answer:
      'Sí. Debes enviar exactamente el importe indicado en la pantalla de pago.',
    sortOrder: 50,
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    categoryId: CRYPTO,
    question: '¿Qué ocurre si envío menos USDT?',
    answer:
      'El pedido no se considerará pagado. Podrás generar un nuevo intento de pago con las instrucciones actualizadas.',
    sortOrder: 60,
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    categoryId: CRYPTO,
    question: '¿Qué ocurre si uso otra red?',
    answer:
      'Usa únicamente la red indicada. Un envío por otra red puede hacer que los fondos se pierdan.',
    sortOrder: 70,
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    categoryId: CRYPTO,
    question: '¿Cómo se confirma el pago?',
    answer:
      'La confirmación es automática cuando el sistema detecta correctamente la operación. La pantalla del pedido se actualizará sola.',
    sortOrder: 80,
  },
  {
    id: '20000000-0000-4000-8000-000000000001',
    categoryId: WALLET,
    question: '¿Cómo pago con el saldo de Mi Billetera?',
    answer:
      'Selecciona Mi Billetera — Saldo y confirma tu pedido. Generaremos una solicitud de cobro; abre la app de Mi Billetera y págala con el saldo de tu cuenta.',
    sortOrder: 10,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    categoryId: WALLET,
    question: '¿Qué datos necesito para pagar la solicitud?',
    answer:
      'La pantalla de pago te mostrará el importe y el número de solicitud o referencia. Podrás copiarlo si lo necesitas para encontrarla en la app.',
    sortOrder: 20,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    categoryId: WALLET,
    question: '¿Cómo sé que mi pago con saldo fue confirmado?',
    answer:
      'Cuando Mi Billetera confirme la solicitud, Maxi Habana actualizará el estado del pago automáticamente.',
    sortOrder: 30,
  },
  {
    id: '30000000-0000-4000-8000-000000000001',
    categoryId: ORDERS,
    question: '¿Cómo puedo pagar mi pedido?',
    answer:
      'En el checkout elige una de las formas de pago disponibles y confirma el pedido. Después verás las instrucciones necesarias para completar el pago.',
    sortOrder: 10,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    categoryId: ORDERS,
    question: '¿Mi pedido queda reservado mientras realizo el pago?',
    answer:
      'Sí. Al confirmar el pedido, los productos quedan reservados mientras completas el pago dentro del plazo indicado.',
    sortOrder: 20,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    categoryId: ORDERS,
    question: '¿Puedo volver a intentar el pago si falla?',
    answer:
      'Sí. Si el pago falla o las instrucciones vencen, podrás generar un nuevo intento desde la página de tu pedido.',
    sortOrder: 30,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    categoryId: ORDERS,
    question: '¿Qué hago si pagué y mi pedido todavía aparece pendiente?',
    answer:
      'Espera unos momentos: la pantalla se actualiza automáticamente cuando recibimos la confirmación. Si el estado no cambia, contáctanos para ayudarte.',
    sortOrder: 40,
    linkLabel: 'Ir a Contacto',
    linkHref: '/contacto',
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    categoryId: ORDERS,
    question: '¿Dónde puedo consultar el estado de mi pedido?',
    answer:
      'Puedes revisar el estado y los datos de cada compra desde la sección Mis pedidos.',
    sortOrder: 50,
    linkLabel: 'Ver Mis pedidos',
    linkHref: '/pedidos',
  },
  {
    id: '30000000-0000-4000-8000-000000000006',
    categoryId: ORDERS,
    question: '¿Qué hago si necesito ayuda con un pedido o pago?',
    answer:
      'Escríbenos desde la página de Contacto e incluye el número de tu pedido para que podamos orientarte.',
    sortOrder: 60,
    linkLabel: 'Contactar al equipo',
    linkHref: '/contacto',
  },
];

export class AddCmsFaq1788820000000 implements MigrationInterface {
  name = 'AddCmsFaq1788820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cms_faq_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(160) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cms_faq_categories" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "cms_faq_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "category_id" uuid NOT NULL,
        "question" character varying(300) NOT NULL,
        "answer" text NOT NULL,
        "link_label" character varying(120),
        "link_href" character varying(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cms_faq_questions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cms_faq_questions_category" FOREIGN KEY ("category_id")
          REFERENCES "cms_faq_categories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_cms_faq_categories_public_order" ON "cms_faq_categories" ("is_active", "sort_order") WHERE "deleted_at" IS NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_cms_faq_questions_category_order" ON "cms_faq_questions" ("category_id", "is_active", "sort_order") WHERE "deleted_at" IS NULL',
    );

    const categories = [
      [CRYPTO, 'Mi Billetera — Criptomonedas', 10],
      [WALLET, 'Mi Billetera — Saldo', 20],
      [ORDERS, 'Pagos y pedidos', 30],
    ] as const;
    for (const [id, title, sortOrder] of categories) {
      await queryRunner.query(
        'INSERT INTO "cms_faq_categories" ("id", "title", "sort_order") VALUES ($1, $2, $3)',
        [id, title, sortOrder],
      );
    }
    for (const item of questions) {
      await queryRunner.query(
        `INSERT INTO "cms_faq_questions"
          ("id", "category_id", "question", "answer", "link_label", "link_href", "sort_order")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          item.id,
          item.categoryId,
          item.question,
          item.answer,
          item.linkLabel ?? null,
          item.linkHref ?? null,
          item.sortOrder,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "cms_faq_questions"');
    await queryRunner.query('DROP TABLE "cms_faq_categories"');
  }
}
