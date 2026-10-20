import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  ComplaintEvent,
  ComplaintEventKind,
} from '../entities/complaint-event.entity';
import { Complaint, ComplaintStatus } from '../entities/complaint.entity';

export class CreateComplaintDto {
  @IsUUID()
  clientId: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsUUID()
  motiveId: string;

  @IsString()
  @Length(10, 2000)
  description: string;
}

export class UpdateComplaintDto {
  @IsOptional()
  @IsUUID()
  motiveId?: string;

  @IsOptional()
  @IsString()
  @Length(10, 2000)
  description?: string;

  /** Cadena vacía para dejarla sin asignar. */
  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignedUserId?: string;
}

export class ChangeComplaintStatusDto {
  @IsEnum(ComplaintStatus)
  status: ComplaintStatus;

  /**
   * Obligatoria al pasar a «resuelta»; en los demás pasos es una nota libre
   * que se guarda en el historial.
   */
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  note?: string;
}

/**
 * Una nota suelta en el historial.
 *
 * Va aparte de `ChangeComplaintStatusDto` porque añadir una nota no cambia de
 * estado, y reutilizar aquel obligaba a mandar un `status` que el servidor
 * ignoraba: un campo que miente sobre lo que hace la llamada.
 */
export class AddComplaintNoteDto {
  @IsString()
  @Length(3, 2000)
  note: string;
}

export class ComplaintsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @IsOptional()
  @IsUUID()
  motiveId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

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

export class ComplaintEventResponseDto {
  id: string;
  kind: ComplaintEventKind;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  note: string | null;
  userId: string;
  userName: string | null;
  createdAt: Date;

  static fromEntity(
    entity: ComplaintEvent,
    userName: string | null,
  ): ComplaintEventResponseDto {
    const dto = new ComplaintEventResponseDto();
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
export interface ComplaintNames {
  motiveLabel: string | null;
  clientName: string | null;
  orderNumber: string | null;
  assignedUserName: string | null;
}

export class ComplaintResponseDto {
  id: string;
  clientId: string;
  clientName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  motiveId: string;
  motiveLabel: string | null;
  description: string;
  status: ComplaintStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  createdByUserId: string;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Solo en la ficha; en el listado sobra y pesa. */
  events?: ComplaintEventResponseDto[];

  static fromEntity(
    entity: Complaint,
    names: ComplaintNames,
  ): ComplaintResponseDto {
    const dto = new ComplaintResponseDto();
    dto.id = entity.id;
    dto.clientId = entity.clientId;
    dto.clientName = names.clientName;
    dto.orderId = entity.orderId;
    dto.orderNumber = names.orderNumber;
    dto.motiveId = entity.motiveId;
    dto.motiveLabel = names.motiveLabel;
    dto.description = entity.description;
    dto.status = entity.status;
    dto.assignedUserId = entity.assignedUserId;
    dto.assignedUserName = names.assignedUserName;
    dto.createdByUserId = entity.createdByUserId;
    dto.resolution = entity.resolution;
    dto.resolvedAt = entity.resolvedAt;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
