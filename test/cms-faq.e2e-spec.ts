import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CmsFaqCategory } from '../src/cms/entities/cms-faq-category.entity';
import { CmsFaqQuestion } from '../src/cms/entities/cms-faq-question.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';
jest.setTimeout(30_000);

describe('CMS FAQ (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let categories: Repository<CmsFaqCategory>;
  let questions: Repository<CmsFaqQuestion>;

  const adminAuth = { Authorization: 'Bearer mock:clerk_faq_admin' };
  const titlePrefix = 'FAQ e2e';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    users = moduleRef.get(getRepositoryToken(User));
    categories = moduleRef.get(getRepositoryToken(CmsFaqCategory));
    questions = moduleRef.get(getRepositoryToken(CmsFaqQuestion));
  });

  beforeEach(async () => {
    await categories.query(
      `DELETE FROM cms_faq_categories WHERE title LIKE '${titlePrefix}%'`,
    );
    await users.delete({ clerkId: 'clerk_faq_admin' });
    await users.save(
      users.create({
        clerkId: 'clerk_faq_admin',
        email: 'faq-admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );
  });

  afterAll(async () => {
    if (categories) {
      await categories.query(
        `DELETE FROM cms_faq_categories WHERE title LIKE '${titlePrefix}%'`,
      );
    }
    if (users) await users.delete({ clerkId: 'clerk_faq_admin' });
    if (app) await app.close();
  });

  it('publica solo categorías y preguntas activas, ordenadas y no vacías', async () => {
    const visibleCategory = await createCategory('visible', 90);
    await createCategory('empty', 91);
    const hiddenCategory = await createCategory('hidden', 92, false);

    await createQuestion(visibleCategory.id, 'segunda', 20);
    await createQuestion(visibleCategory.id, 'primera', 10);
    await createQuestion(visibleCategory.id, 'inactiva', 0, false);
    await createQuestion(hiddenCategory.id, 'oculta por categoría', 0);

    const response = await request(app.getHttpServer())
      .get('/api/public/cms/faqs')
      .expect(200);

    const ownCategories = response.body.data.filter(
      (category: { title: string }) => category.title.startsWith(titlePrefix),
    );
    expect(ownCategories).toHaveLength(1);
    expect(ownCategories[0].title).toBe(`${titlePrefix} visible`);
    expect(
      ownCategories[0].questions.map(
        (question: { question: string }) => question.question,
      ),
    ).toEqual(['primera', 'segunda']);
  });

  it('permite CRUD administrativo y aplica borrado lógico en cascada', async () => {
    const category = await createCategory('crud', 100);

    const invalidLink = await request(app.getHttpServer())
      .post('/api/cms/faq/questions')
      .set(adminAuth)
      .send({
        categoryId: category.id,
        question: 'enlace incompleto',
        answer: 'No debe guardarse.',
        linkLabel: 'Ayuda',
      })
      .expect(422);
    expect(invalidLink.body.message).toBeDefined();

    const created = await createQuestion(category.id, 'editable', 1, true, {
      label: 'Contactanos',
      href: '/contacto',
    });

    const updated = await request(app.getHttpServer())
      .patch(`/api/cms/faq/questions/${created.id}`)
      .set(adminAuth)
      .send({ question: 'editada', sortOrder: 2 })
      .expect(200);
    expect(updated.body.data.question).toBe('editada');

    const categoriesResponse = await request(app.getHttpServer())
      .get('/api/cms/faq/categories')
      .set(adminAuth)
      .expect(200);
    const ownCategory = categoriesResponse.body.data.find(
      (item: { id: string }) => item.id === category.id,
    );
    expect(ownCategory.questionCount).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/cms/faq/categories/${category.id}`)
      .set(adminAuth)
      .expect(204);

    expect(
      await categories.findOne({
        where: { id: category.id },
        withDeleted: true,
      }),
    ).toMatchObject({ id: category.id });
    expect(
      await questions.findOne({ where: { id: created.id }, withDeleted: true }),
    ).toMatchObject({ id: created.id });
    expect(await categories.findOneBy({ id: category.id })).toBeNull();
    expect(await questions.findOneBy({ id: created.id })).toBeNull();
  });

  it('rechaza relaciones inexistentes y acceso administrativo anónimo', async () => {
    await request(app.getHttpServer())
      .get('/api/cms/faq/categories')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/cms/faq/questions')
      .set(adminAuth)
      .send({
        categoryId: '00000000-0000-0000-0000-000000000099',
        question: 'sin categoría',
        answer: 'No debe guardarse.',
      })
      .expect(404);
  });

  async function createCategory(
    suffix: string,
    sortOrder: number,
    isActive = true,
  ): Promise<CmsFaqCategory> {
    await request(app.getHttpServer())
      .post('/api/cms/faq/categories')
      .set(adminAuth)
      .send({ title: `${titlePrefix} ${suffix}`, sortOrder, isActive })
      .expect(201);
    return categories.findOneByOrFail({ title: `${titlePrefix} ${suffix}` });
  }

  async function createQuestion(
    categoryId: string,
    question: string,
    sortOrder: number,
    isActive = true,
    link?: { label: string; href: string },
  ): Promise<CmsFaqQuestion> {
    await request(app.getHttpServer())
      .post('/api/cms/faq/questions')
      .set(adminAuth)
      .send({
        categoryId,
        question,
        answer: `Respuesta para ${question}.`,
        sortOrder,
        isActive,
        ...(link ? { linkLabel: link.label, linkHref: link.href } : undefined),
      })
      .expect(201);
    return questions.findOneByOrFail({ categoryId, question });
  }
});
