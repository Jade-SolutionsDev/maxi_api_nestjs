import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CmsFaqService } from './cms-faq.service';
import { CmsFaqCategory } from './entities/cms-faq-category.entity';
import { CmsFaqQuestion } from './entities/cms-faq-question.entity';

type RepoMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
};

const repo = (): RepoMock => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((value: unknown) => value),
  save: jest.fn((value: unknown) => Promise.resolve(value)),
  softDelete: jest.fn(),
});

const category = (
  overrides: Partial<CmsFaqCategory> = {},
): CmsFaqCategory =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Pagos',
    sortOrder: 10,
    isActive: true,
    questions: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  }) as CmsFaqCategory;

const question = (
  overrides: Partial<CmsFaqQuestion> = {},
): CmsFaqQuestion =>
  ({
    id: '22222222-2222-4222-8222-222222222222',
    categoryId: '11111111-1111-4111-8111-111111111111',
    question: '¿Cómo pago?',
    answer: 'Sigue las instrucciones.',
    linkLabel: null,
    linkHref: null,
    sortOrder: 10,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  }) as CmsFaqQuestion;

describe('CmsFaqService', () => {
  let service: CmsFaqService;
  let categoryRepo: RepoMock;
  let questionRepo: RepoMock;
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    categoryRepo = repo();
    questionRepo = repo();
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsFaqService,
        {
          provide: getRepositoryToken(CmsFaqCategory),
          useValue: categoryRepo,
        },
        {
          provide: getRepositoryToken(CmsFaqQuestion),
          useValue: questionRepo,
        },
        { provide: RevalidationService, useValue: revalidation },
      ],
    }).compile();

    service = module.get(CmsFaqService);
  });

  it('returns only active questions and omits empty public categories', async () => {
    categoryRepo.find.mockResolvedValue([
      category({
        questions: [
          question(),
          question({ id: 'inactive', isActive: false }),
        ],
      }),
      category({ id: 'empty', title: 'Vacía', questions: [] }),
    ]);

    const result = await service.listPublic();

    expect(result).toHaveLength(1);
    expect(result[0].questions).toHaveLength(1);
    expect(categoryRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
      relations: { questions: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  });

  it('creates questions only inside an existing category', async () => {
    categoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createQuestion({
        categoryId: '11111111-1111-4111-8111-111111111111',
        question: '¿Cómo pago?',
        answer: 'Sigue las instrucciones.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists a category and invalidates the CMS cache', async () => {
    await service.createCategory({ title: 'Pagos', sortOrder: 20 });

    expect(categoryRepo.create).toHaveBeenCalledWith({
      title: 'Pagos',
      sortOrder: 20,
      isActive: true,
    });
    expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
  });

  it('soft-deletes a category and all its questions', async () => {
    categoryRepo.findOne.mockResolvedValue(category());

    await service.removeCategory('11111111-1111-4111-8111-111111111111');

    expect(questionRepo.softDelete).toHaveBeenCalledWith({
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(categoryRepo.softDelete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
  });
});
