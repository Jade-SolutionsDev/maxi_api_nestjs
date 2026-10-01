import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { User } from '../users/entities/user.entity';
import { CmsHomeChangeAction } from './cms-home.types';
import { CmsHomeChange } from './entities/cms-home-change.entity';

/** How an author reads in the log: full name, else email, else id. */
export const describeActor = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
  user.email ||
  user.id;

@Injectable()
export class CmsHomeChangesService {
  constructor(
    @InjectRepository(CmsHomeChange)
    private readonly changeRepository: Repository<CmsHomeChange>,
  ) {}

  async record(
    action: CmsHomeChangeAction,
    subject: string | null,
    actor: User,
  ): Promise<void> {
    await this.changeRepository.save(
      this.changeRepository.create({
        action,
        subject,
        actorId: actor.id,
        actorName: describeActor(actor),
      }),
    );
  }

  listRecent(limit: number): Promise<CmsHomeChange[]> {
    return this.changeRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
