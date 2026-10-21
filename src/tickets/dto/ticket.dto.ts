import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { TicketEvent, TicketEventKind } from '../entities/ticket-event.entity';
import {
  Ticket,
  TicketPriority,
  TicketStatus,
} from '../entities/ticket.entity';

/** Tope de fotos por ticket. Una incidencia que necesita más es dos. */
export const MAX_IMAGENES = 6;

/**
 * Cómo se valida la dirección de una foto.
 *
 * `require_protocol` y la lista de protocolos van **explícitos**. Sin ellos,
 * `@IsUrl()` rechaza `javascript:` y `data:` igual —por el valor por omisión de
 * su lista interna— pero **acepta `tickets/a.png`**, una ruta relativa sin
 * esquema: no es un ataque, es un valor que se guarda y luego se pinta como un
 * enlace relativo a la página en la que estés. Comprobado con las ocho
 * variantes de abajo.
 *
 * Que la protección contra `javascript:` dependa de un valor por omisión que
 * nadie escribió es lo que lo hacía frágil: basta que alguien añada una opción
 * a este decorador para perderla sin darse cuenta.
 *
 * `require_tld: false` se queda porque en desarrollo el almacenamiento es
 * `http://localhost:9000`. Lo que **no** se comprueba aquí es que la dirección
 * salga de nuestro almacenamiento: el host cambia por entorno —Cloudinary en
 * producción, MinIO en local— y fijarlo en el DTO obligaría a desplegar para
 * cambiar de proveedor. Quien escribe aquí ya tiene `tickets:create`.
 */
export const IMAGEN_URL = {
  require_protocol: true,
  require_tld: false,
  protocols: ['http', 'https'],
};

export class CreateTicketDto {
  @IsString()
  @Length(5, 160)
  title: string;

  @IsString()
  @Length(10, 4000)
  description: string;

  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  /** Se puede abrir ya asignado, o dejarlo para que alguien lo coja. */
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGENES)
  @IsUrl(IMAGEN_URL, { each: true })
  images?: string[];
}

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @Length(5, 160)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(10, 4000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  /** Cadena vacía para dejarlo sin asignar. */
  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignedUserId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGENES)
  @IsUrl(IMAGEN_URL, { each: true })
  images?: string[];
}

export class ChangeTicketStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;

  /**
   * Obligatoria al pasar a «resuelto» —ahí es el qué se hizo— y al reabrir un
   * ticket ya cerrado. En los demás pasos es una nota libre que se guarda en
   * el historial.
   */
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  note?: string;
}

/**
 * Un comentario del ticket.
 *
 * Va aparte de `ChangeTicketStatusDto` porque comentar no cambia de estado, y
 * reutilizar aquel obligaba a mandar un `status` que el servidor ignora: un
 * campo que miente sobre lo que hace la llamada. Mismo error que ya se corrigió
 * en las quejas (MxH-0064).
 */
export class AddTicketCommentDto {
  @IsString()
  @Length(3, 2000)
  note: string;
}

export class TicketsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  /** Límite inferior inclusivo, aaaa-mm-dd. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  createdFrom?: string;

  /** Límite superior inclusivo, aaaa-mm-dd. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  createdTo?: string;
}

export class TicketEventResponseDto {
  id: string;
  kind: TicketEventKind;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  note: string | null;
  userId: string;
  userName: string | null;
  createdAt: Date;

  static fromEntity(
    entity: TicketEvent,
    userName: string | null,
  ): TicketEventResponseDto {
    const dto = new TicketEventResponseDto();
    dto.id = entity.id;
    dto.kind = entity.kind;
    dto.fromStatus = entity.fromStatus;
    dto.toStatus = entity.toStatus;
    dto.note = entity.note;
    dto.userId = entity.userId;
    dto.userName = userName;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

/** Lo que hace falta para pintar una fila o una ficha sin más consultas. */
export interface TicketNames {
  categoryLabel: string | null;
  assignedUserName: string | null;
  createdByUserName: string | null;
}

export class TicketResponseDto {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  categoryLabel: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  createdByUserId: string;
  createdByUserName: string | null;
  images: string[];
  resolution: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Solo en la ficha; en el listado sobra y pesa. */
  events?: TicketEventResponseDto[];

  static fromEntity(entity: Ticket, names: TicketNames): TicketResponseDto {
    const dto = new TicketResponseDto();
    dto.id = entity.id;
    dto.title = entity.title;
    dto.description = entity.description;
    dto.categoryId = entity.categoryId;
    dto.categoryLabel = names.categoryLabel;
    dto.priority = entity.priority;
    dto.status = entity.status;
    dto.assignedUserId = entity.assignedUserId;
    dto.assignedUserName = names.assignedUserName;
    dto.createdByUserId = entity.createdByUserId;
    dto.createdByUserName = names.createdByUserName;
    dto.images = entity.images ?? [];
    dto.resolution = entity.resolution;
    dto.resolvedAt = entity.resolvedAt;
    dto.closedAt = entity.closedAt;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
