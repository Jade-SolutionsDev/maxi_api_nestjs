import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { User } from '../users/entities/user.entity';
import {
  CmsHomeChangesService,
  describeActor,
} from './cms-home-changes.service';
import { CmsHomeChangeAction } from './cms-home.types';
import { CmsHomeChange } from './entities/cms-home-change.entity';

describe('CmsHomeChangesService', () => {
  let service: CmsHomeChangesService;
  let repo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input: unknown) => input),
      save: jest.fn((input: unknown) => Promise.resolve(input)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsHomeChangesService,
        { provide: getRepositoryToken(CmsHomeChange), useValue: repo },
      ],
    }).compile();

    service = module.get(CmsHomeChangesService);
  });

  it('stores what changed and who did it', async () => {
    await service.record(CmsHomeChangeAction.BANNER_UPDATED, 'Oferta semanal', {
      id: 'user-1',
      firstName: 'Ana',
      lastName: 'Pérez',
    } as User);

    expect(repo.save).toHaveBeenCalledWith({
      action: CmsHomeChangeAction.BANNER_UPDATED,
      subject: 'Oferta semanal',
      actorId: 'user-1',
      actorName: 'Ana Pérez',
    });
  });

  it('lists the latest changes first', async () => {
    await service.listRecent(20);

    expect(repo.find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      take: 20,
    });
  });

  it('names the author by email, then by id, when the profile has no name', () => {
    expect(describeActor({ id: 'user-2', email: 'web@maxi.cu' } as User)).toBe(
      'web@maxi.cu',
    );
    expect(describeActor({ id: 'user-3' } as User)).toBe('user-3');
  });
});
