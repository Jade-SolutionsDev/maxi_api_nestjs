import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/auth.constants';

/** Mark a route as public so the global {@link AuthGuard} skips authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
