import { SetMetadata } from '@nestjs/common';
import { Role } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../constants/auth.constants';

/**
 * Restrict a route (or controller) to the given system roles. Enforced by the
 * global {@link RolesGuard}. With no roles listed, any authenticated user passes.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
