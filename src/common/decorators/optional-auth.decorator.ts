import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/** Public route that still attaches `request.user` when a valid Bearer token is sent. */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
