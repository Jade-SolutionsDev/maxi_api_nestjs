/**
 * A user-facing notification to deliver. Kept intentionally small; extend as new
 * notification kinds are added (password reset, order updates, ...).
 */
export interface InvitationNotification {
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
  /** The acceptance/redirect URL, when the caller has one to include. */
  invitationUrl?: string;
}

export interface NotificationResult {
  /** Whether the notification was (or will be) dispatched to the recipient. */
  sent: boolean;
  /** Populated when `sent` is false, explaining why. */
  skippedReason?: string;
}

/**
 * Swappable notification backend. The default implementation delegates to
 * Clerk's built-in invitation emails; other implementations (a transactional
 * email vendor, an in-app inbox, ...) can be dropped in without touching the
 * services that raise notifications. Selected via the {@link NOTIFICATION_PROVIDER}
 * token.
 */
export abstract class NotificationProvider {
  abstract sendInvitation(
    notification: InvitationNotification,
  ): Promise<NotificationResult>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
