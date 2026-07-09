import { BadRequestException } from '@nestjs/common';
import { Role, User } from '../../users/entities/user.entity';

const SLUG_SEPARATOR = /[^\da-z]+/gi;

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(SLUG_SEPARATOR, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  );
}

export function resolveProviderId(
  user: User,
  requestedProviderId?: string,
): string {
  if (user.role === Role.GROCER) {
    return user.id;
  }

  if (!requestedProviderId) {
    throw new BadRequestException(
      'providerId is required for non-provider users',
    );
  }

  return requestedProviderId;
}

export function buildOwnerScope(user: User): Record<string, string> {
  const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
  return isAdmin ? {} : { providerId: user.id };
}
