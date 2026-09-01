import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NomenclatorsModule } from '../nomenclators/nomenclators.module';
import { User } from '../users/entities/user.entity';
import { ContactMailService } from './contact-mail.service';
import { ContactMessagesController } from './contact-messages.controller';
import { ContactService } from './contact.service';
import { ContactTemplatesController } from './contact-templates.controller';
import { ContactMessage } from './entities/contact-message.entity';
import { ContactReply } from './entities/contact-reply.entity';
import { ContactReplyTemplate } from './entities/contact-reply-template.entity';
import { PublicContactController } from './public-contact.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContactMessage,
      ContactReply,
      ContactReplyTemplate,
      User,
    ]),
    NomenclatorsModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [
    PublicContactController,
    ContactMessagesController,
    ContactTemplatesController,
  ],
  providers: [ContactService, ContactMailService],
})
export class ContactModule {}
