import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_PROVIDER } from './interfaces/notification-provider.interface';
import { ClerkNotificationProvider } from './providers/clerk-notification.provider';
import { NoopNotificationProvider } from './providers/noop-notification.provider';

@Module({
  providers: [
    ClerkNotificationProvider,
    NoopNotificationProvider,
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [
        ConfigService,
        ClerkNotificationProvider,
        NoopNotificationProvider,
      ],
      useFactory: (
        configService: ConfigService,
        clerk: ClerkNotificationProvider,
        noop: NoopNotificationProvider,
      ) => (configService.get<boolean>('notifications.enabled') ? clerk : noop),
    },
  ],
  exports: [NOTIFICATION_PROVIDER],
})
export class NotificationsModule {}
