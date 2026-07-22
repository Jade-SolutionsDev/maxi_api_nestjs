import { User } from '../entities/user.entity';

export class UserResponseDto {
  id: string;
  clerkId: string | null;
  role: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  businessName: string | null;
  businessDescription: string | null;
  businessLogoUrl: string | null;
  clerkOrgId: string | null;
  isActive: boolean;
  status?: 'active' | 'inactive' | 'pending' | 'deleted' | 'awaiting_approval';
  isPending?: boolean;
  isDeleted?: boolean;
  /** Registered but not yet approved by an admin (isActive=false, approvedAt=null). */
  isAwaitingApproval?: boolean;
  deletedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(user: User, isPending = false): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.clerkId = user.clerkId;
    dto.role = user.role;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phone = user.phone;
    dto.avatarUrl = user.avatarUrl;
    dto.businessName = user.businessName;
    dto.businessDescription = user.businessDescription;
    dto.businessLogoUrl = user.businessLogoUrl;
    dto.clerkOrgId = user.clerkOrgId;
    dto.isActive = user.isActive;
    dto.deletedAt = user.deletedAt ?? null;
    dto.isDeleted = !isPending && !!user.deletedAt;
    dto.isPending = isPending;
    dto.isAwaitingApproval =
      !isPending && !dto.isDeleted && !user.isActive && !user.approvedAt;
    dto.status = isPending
      ? 'pending'
      : dto.isDeleted
        ? 'deleted'
        : user.isActive
          ? 'active'
          : dto.isAwaitingApproval
            ? 'awaiting_approval'
            : 'inactive';
    dto.createdBy = user.createdBy;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
