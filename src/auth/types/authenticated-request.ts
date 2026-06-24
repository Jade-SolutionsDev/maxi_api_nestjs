import { Request } from 'express';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../users/entities/user.entity';

export interface AuthenticatedUserRequest extends Request {
  user: User;
}

export interface AuthenticatedClientRequest extends Request {
  client: Client;
}
