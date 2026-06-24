import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('clerk')
  async handleClerk(@Req() request: RequestWithRawBody) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Missing raw body for webhook verification',
      );
    }

    return this.webhooksService.handleClerkWebhook(rawBody, request.headers);
  }
}
