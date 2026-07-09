import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

// Clerk's signed webhook calls carry no Bearer token; they self-authenticate
// via signature verification inside the service.
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('clerk/store')
  @HttpCode(200)
  async handleClerkStore(@Req() request: RequestWithRawBody) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Missing raw body for webhook verification',
      );
    }

    return this.webhooksService.handleStoreWebhook(rawBody, request.headers);
  }

  @Post('clerk/admin')
  @HttpCode(200)
  async handleClerkAdmin(@Req() request: RequestWithRawBody) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Missing raw body for webhook verification',
      );
    }

    return this.webhooksService.handleAdminWebhook(rawBody, request.headers);
  }
}
