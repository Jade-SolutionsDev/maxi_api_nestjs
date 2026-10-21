import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TicketStatus {
  ABIERTO = 'abierto',
  EN_CURSO = 'en_curso',
  RESUELTO = 'resuelto',
  CERRADO = 'cerrado',
}

export enum TicketPriority {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
}

/**
 * Una incidencia interna de la tienda: algo que le pasa al equipo, no a un
 * cliente (MxH-0065).
 *
 * **Qué lo separa de una queja.** Una queja (`complaints`, MxH-0064) viene de
 * fuera, la abre quien atiende el teléfono en nombre de un cliente, y cuando
 * se resuelve hay alguien a quien llamar. Un ticket viene de dentro, lo abre
 * quien se tropieza con el problema, y el interesado es el propio equipo. Por
 * eso aquí no hay `clientId` y sí `title`: una queja se identifica por el
 * cliente y el motivo, un ticket por lo que dice su título en un listado de
 * cincuenta.
 *
 * **Cuatro estados y no tres**, que es lo que decidió Jade el 21-oct-2026:
 * `resuelto` lo pone quien lo arregló —«ya está»— y `cerrado` quien lo abrió o
 * quien supervisa —«confirmo, archívalo»—. Separarlos es lo que impide que una
 * incidencia se dé por buena sin que la haya comprobado nadie más que quien la
 * tocó; si no estaba arreglada, vuelve a `en_curso` y no hay que abrir otra.
 *
 * La categoría no es un enumerado: apunta a una fila de `nomenclators` de la
 * categoría `ticket-category`, que se edita desde el panel. Fijarlas en código
 * obligaría a desplegar para añadir una.
 *
 * Referencias por uuid pelado, sin relaciones de TypeORM: convención de la
 * casa.
 */
@Entity('tickets')
@Index('IDX_tickets_status', ['status'])
@Index('IDX_tickets_priority', ['priority'])
@Index('IDX_tickets_category_id', ['categoryId'])
@Index('IDX_tickets_assigned_user_id', ['assignedUserId'])
@Index('IDX_tickets_created_at', ['createdAt'])
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({
    type: 'enum',
    enum: TicketPriority,
    default: TicketPriority.MEDIA,
  })
  priority: TicketPriority;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.ABIERTO })
  status: TicketStatus;

  /** Quién lo atiende. Vacío mientras nadie lo ha cogido. */
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  /** Quién lo abrió. No cambia nunca. */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  /**
   * Fotos de la incidencia: las direcciones que devolvió `POST /uploads/image`
   * con la carpeta `tickets`. Una lista de cadenas en `jsonb`, como el resto
   * de las listas de la casa.
   *
   * Aquí solo se guarda la dirección. Quien no tenga `uploads:create` puede
   * abrir el ticket pero no adjuntar, y el panel le esconde el botón: subir
   * ficheros al almacenamiento es un permiso que ya existía y no se reparte
   * de rebote por abrir una incidencia.
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  images: string[];

  /**
   * Qué se hizo. Se exige al pasarlo a `resuelto`: un ticket resuelto sin
   * explicación no le sirve de nada al siguiente que se tropiece con lo mismo,
   * y es justo lo que mira quien tiene que confirmarlo antes de cerrarlo.
   */
  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
