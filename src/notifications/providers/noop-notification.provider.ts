import { Injectable } from '@nestjs/common';
import {
  NotificationProvider,
  NotificationResult,
} from '../interfaces/notification-provider.interface';

/**
 * Suppresses outbound notifications. Selected when notifications are disabled
 * (`NOTIFICATIONS_ENABLED=false`), e.g. local development and e2e tests, so no
 * invitation emails are dispatched.
 */
@Injectable()
export class NoopNotificationProvider extends NotificationProvider {
  sendInvitation(): Promise<NotificationResult> {
    return Promise.resolve({
      sent: false,
      skippedReason: 'notifications disabled',
    });
  }
}
