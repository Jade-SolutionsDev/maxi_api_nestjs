import { Invitation, InvitationStatus } from '../entities/invitation.entity';

/** Safe representation of an {@link Invitation} — never leaks the raw entity/relations. */
export class InvitationResponseDto {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus;
  firstName: string | null;
  lastName: string | null;
  organizationId: string | null;
  invitedById: string | null;
  clerkInvitationId: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(invitation: Invitation): InvitationResponseDto {
    const dto = new InvitationResponseDto();
    dto.id = invitation.id;
    dto.email = invitation.email;
    dto.role = invitation.role;
    dto.status = invitation.status;
    dto.firstName = invitation.firstName;
    dto.lastName = invitation.lastName;
    dto.organizationId = invitation.organizationId;
    dto.invitedById = invitation.invitedById;
    dto.clerkInvitationId = invitation.clerkInvitationId;
    dto.acceptedAt = invitation.acceptedAt;
    dto.createdAt = invitation.createdAt;
    dto.updatedAt = invitation.updatedAt;
    return dto;
  }
}
