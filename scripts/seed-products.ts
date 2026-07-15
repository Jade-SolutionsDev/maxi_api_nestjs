import { DataSource } from 'typeorm';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { slugify } from '../src/common/utils/catalog-ownership.utils';

/**
 * Additive seed for testing: inserts a small grocery catalog (a department, its
 * child categories, and a set of products). Idempotent — existing rows are left
 * untouched, so it is safe to re-run and NEVER drops data.
 *
 * Run: pnpm run seed:products
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [Category, Product],
  synchronize: false, // tables already exist (managed by the app); only insert.
});

const DEPARTMENT = 'Alimentos';
const CATEGORIES = [
  'Granos y Cereales',
  'Aceites y Grasas',
  'Lácteos',
  'Enlatados',
  'Bebidas',
];

interface SeedProduct {
  name: string;
  category: string;
  measureUnit: string;
  format: string;
  basePrice: number;
  discount: number;
  featured: boolean;
}

const PRODUCTS: SeedProduct[] = [
  { name: 'Arroz Selecto 1 kg', category: 'Granos y Cereales', measureUnit: 'kg', format: 'Bolsa 1 kg', basePrice: 320, discount: 0, featured: true },
  { name: 'Frijoles Negros 1 kg', category: 'Granos y Cereales', measureUnit: 'kg', format: 'Bolsa 1 kg', basePrice: 410, discount: 5, featured: false },
  { name: 'Espaguetis 400 g', category: 'Granos y Cereales', measureUnit: 'g', format: 'Paquete 400 g', basePrice: 180, discount: 0, featured: false },
  { name: 'Harina de Trigo 1 kg', category: 'Granos y Cereales', measureUnit: 'kg', format: 'Bolsa 1 kg', basePrice: 220, discount: 10, featured: false },
  { name: 'Aceite Vegetal 900 ml', category: 'Aceites y Grasas', measureUnit: 'ml', format: 'Botella 900 ml', basePrice: 640, discount: 15, featured: true },
  { name: 'Aceite de Oliva 500 ml', category: 'Aceites y Grasas', measureUnit: 'ml', format: 'Botella 500 ml', basePrice: 1450, discount: 0, featured: false },
  { name: 'Leche Entera 1 L', category: 'Lácteos', measureUnit: 'L', format: 'Caja 1 L', basePrice: 290, discount: 0, featured: false },
  { name: 'Queso Gouda 250 g', category: 'Lácteos', measureUnit: 'g', format: 'Pieza 250 g', basePrice: 780, discount: 5, featured: true },
  { name: 'Atún en Aceite 170 g', category: 'Enlatados', measureUnit: 'g', format: 'Lata 170 g', basePrice: 350, discount: 0, featured: false },
  { name: 'Tomate Triturado 400 g', category: 'Enlatados', measureUnit: 'g', format: 'Lata 400 g', basePrice: 240, discount: 20, featured: false },
  { name: 'Maíz Dulce 300 g', category: 'Enlatados', measureUnit: 'g', format: 'Lata 300 g', basePrice: 210, discount: 0, featured: false },
  { name: 'Café Molido 250 g', category: 'Bebidas', measureUnit: 'g', format: 'Paquete 250 g', basePrice: 560, discount: 10, featured: true },
  { name: 'Refresco de Cola 1.5 L', category: 'Bebidas', measureUnit: 'L', format: 'Botella 1.5 L', basePrice: 300, discount: 0, featured: false },
  { name: 'Azúcar Blanca 1 kg', category: 'Granos y Cereales', measureUnit: 'kg', format: 'Bolsa 1 kg', basePrice: 190, discount: 0, featured: false },
];

const placeholder = (name: string) =>
  `https://placehold.co/200x200/e2e8f0/475569?text=${encodeURIComponent(name.split(' ')[0])}`;

async function ensureCategory(
  repo: import('typeorm').Repository<Category>,
  name: string,
  parentId: string | null,
  sortOrder: number,
): Promise<Category> {
  const slug = slugify(name);
  const existing = await repo.findOne({ where: { slug }, withDeleted: true });
  if (existing) return existing;
  return repo.save(
    repo.create({ name, slug, parentId, sortOrder, isActive: true }),
  );
}

async function main() {
  await dataSource.initialize();
  const categoryRepo = dataSource.getRepository(Category);
  const productRepo = dataSource.getRepository(Product);

  const department = await ensureCategory(categoryRepo, DEPARTMENT, null, 0);
  const categoryByName = new Map<string, Category>();
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const child = await ensureCategory(
      categoryRepo,
      CATEGORIES[i],
      department.id,
      i,
    );
    categoryByName.set(CATEGORIES[i], child);
  }

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < PRODUCTS.length; i += 1) {
    const p = PRODUCTS[i];
    const sku = slugify(p.name).toUpperCase();
    const existing = await productRepo.findOne({
      where: { sku },
      withDeleted: true,
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const category = categoryByName.get(p.category)!;
    await productRepo.save(
      productRepo.create({
        categoryId: category.id,
        sku,
        name: p.name,
        slug: slugify(p.name),
        description: `${p.name} — producto de prueba.`,
        imageUrl: placeholder(p.name),
        format: p.format,
        measureUnit: p.measureUnit,
        basePrice: p.basePrice.toFixed(2),
        discount: p.discount.toFixed(2),
        isFeatured: p.featured,
        sortOrder: i,
        isActive: true,
      }),
    );
    created += 1;
  }

  console.log(
    `Seed complete: ${created} products created, ${skipped} already existed.`,
  );
  await dataSource.destroy();
}

void main();
