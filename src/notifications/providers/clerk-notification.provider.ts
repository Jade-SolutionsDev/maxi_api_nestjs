import { Injectable, Logger } from '@nestjs/common';
import {
  InvitationNotification,
  NotificationProvider,
  NotificationResult,
} from '../interfaces/notification-provider.interface';

/**
 * Default provider. Clerk sends the actual invitation email as part of creating
 * the invitation (via its `notify` flag), so this provider does not dispatch a
 * message itself — it reports that delivery is delegated to Clerk. It exists as
 * the seam that a future vendor-backed provider can replace.
 */
@Injectable()
export class ClerkNotificationProvider extends NotificationProvider {
  private readonly logger = new Logger(ClerkNotificationProvider.name);

  sendInvitation(
    notification: InvitationNotification,
  ): Promise<NotificationResult> {
    this.logger.log(
      `Delegating invitation notification for ${notification.email} to Clerk`,
    );
    return Promise.resolve({ sent: true });
  }
}
