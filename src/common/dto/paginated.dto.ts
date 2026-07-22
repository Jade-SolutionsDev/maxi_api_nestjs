import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHideProperty,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * Paginated list envelope. The global ResponseInterceptor wraps this as
 * `{ data: PaginatedDto }`, so clients read `res.data.items` + `res.data.total`.
 */
export class PaginatedDto<T> {
  // Hidden from the base schema (the generic `T[]` confuses the Swagger CLI
  // plugin); ApiPaginatedResponse supplies the real element schema per-endpoint.
  @ApiHideProperty()
  items: T[];

  @ApiProperty({ description: 'Total matching rows across all pages.' })
  total: number;

  @ApiProperty({ description: '1-based current page.' })
  page: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Page size; null when all rows were returned on one page.',
  })
  limit: number | null;

  @ApiProperty()
  totalPages: number;
}

/**
 * Slice an in-memory list into a page. `limit` omitted → everything on one page.
 * ponytail: in-memory paging over the (small) catalog; move to SQL LIMIT/OFFSET
 * + COUNT if these lists ever grow large.
 */
export function paginate<T>(
  all: T[],
  page?: number,
  limit?: number,
): PaginatedDto<T> {
  const total = all.length;
  if (limit == null) {
    return {
      items: all,
      total,
      page: 1,
      limit: null,
      totalPages: total ? 1 : 0,
    };
  }
  const currentPage = page && page > 0 ? page : 1;
  const start = (currentPage - 1) * limit;
  return {
    items: all.slice(start, start + limit),
    total,
    page: currentPage,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/** Swagger: documents a `PaginatedDto` whose `items` are `model`. */
export const ApiPaginatedResponse = <M extends Type<unknown>>(model: M) =>
  applyDecorators(
    ApiExtraModels(PaginatedDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedDto) },
          {
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
