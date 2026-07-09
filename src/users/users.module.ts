import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Invitation } from './entities/invitation.entity';
import { User } from './entities/user.entity';
import { InvitationsService } from './invitations.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Invitation]),
    forwardRef(() => AuthModule),
    NotificationsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, InvitationsService],
  exports: [UsersService, InvitationsService],
})
export class UsersModule {}
