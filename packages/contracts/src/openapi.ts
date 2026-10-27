import type { TableSchema, RPCOperation } from './index';
/** Generated descriptions use the exposed schema only; hidden columns never enter this artifact. */
export function projectOpenAPI(
  tables: TableSchema[],
  operations: RPCOperation[],
  version: number,
  url: string,
) {
  const column = (c: TableSchema['columns'][number]) => {
    const type = /INT|NUMERIC|DECIMAL/i.test(c.type)
      ? ['BIGINT', 'string']
      : /REAL|FLOAT|DOUBLE|NUMERIC/i.test(c.type)
        ? ['number']
        : ['string'];
    return {
      type: c.nullable ? [...type, 'null'] : type,
      ...(c.enum?.length ? { enum: [...c.enum, ...(c.nullable ? [null] : [])] } : {}),
      ...(c.type.toUpperCase() === 'BYTEA' ? { contentEncoding: 'base64' } : {}),
    };
  };
  const error = {
    description: 'Normalized QB Flex error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Failure' } } },
  };
  const paths: Record<string, unknown> = {},
    schemas: Record<string, unknown> = {
      Failure: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId', 'retryable'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
              retryable: { type: 'boolean' },
            },
          },
        },
      },
      Meta: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          schemaVersion: { type: 'integer' },
          cursor: { type: 'string' },
          count: { type: 'integer' },
          consistencyToken: { type: 'string' },
        },
      },
    };
  for (const t of tables) {
    const properties = Object.fromEntries(t.columns.map((c) => [c.name, column(c)]));
    schemas[t.name] = { type: 'object', properties, additionalProperties: false };
    const success = {
      description: 'Only policy-readable rows and columns are returned',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: `#/components/schemas/${t.name}` } },
              meta: { $ref: '#/components/schemas/Meta' },
            },
          },
        },
      },
    };
    const responses = {
      '200': success,
      '400': error,
      '401': error,
      '403': error,
      '404': error,
      '409': error,
      '429': error,
      '503': error,
    };
    const body = {
      required: true,
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: `#/components/schemas/${t.name}` },
              {
                type: 'array',
                maxItems: 100,
                minItems: 1,
                items: { $ref: `#/components/schemas/${t.name}` },
              },
            ],
          },
        },
      },
    };
    paths[`/data/${t.name}`] = {
      get: {
        summary: `Read ${t.name}`,
        parameters: [
          { name: 'select', in: 'query', schema: { type: 'string' } },
          {
            name: 'filters',
            in: 'query',
            schema: { type: 'string' },
            description: 'JSON array of allowlisted filter expressions',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'BIGINT', minimum: 1, maximum: 500, default: 50 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses,
      },
      post: { summary: `Insert ${t.name}`, requestBody: body, responses },
    };
    paths[`/data/${t.name}/query`] = {
      post: {
        summary: `Structured ${t.name} query`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: { type: 'string', enum: t.allowedColumns } },
                  limit: { type: 'integer', minimum: 1, maximum: 500 },
                  cursor: { type: 'string' },
                  count: { type: 'boolean' },
                  filters: { type: 'array', maxItems: 30, items: { type: 'object' } },
                  order: { type: 'array', maxItems: 10, items: { type: 'object' } },
                  relations: { type: 'array', maxItems: 3, items: { type: 'object' } },
                  groupBy: { type: 'array', items: { type: 'string', enum: t.allowedColumns }, maxItems: 5 },
                  aggregates: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                      type: 'object',
                      properties: {
                        alias: { type: 'string' },
                        fn: { type: 'string', enum: ['count', 'countDistinct', 'sum', 'avg', 'min', 'max'] },
                        column: { type: 'string', enum: t.allowedColumns },
                      },
                      required: ['alias', 'fn'],
                    },
                  },
                  having: {
                    type: 'array',
                    maxItems: 10,
                    items: {
                      type: 'object',
                      properties: {
                        alias: { type: 'string' },
                        op: { type: 'string', enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] },
                        value: { type: ['string', 'number', 'boolean', 'null'] },
                      },
                      required: ['alias', 'op', 'value'],
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses,
      },
    };
    paths[`/data/${t.name}/upsert`] = {
      post: {
        summary: `Upsert ${t.name} through insert and update policies`,
        requestBody: body,
        responses,
      },
    };
    paths[`/data/${t.name}/{key}`] = {
      parameters: [
        {
          name: 'key',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Scalar primary key or base64url encoded composite-key JSON array',
        },
      ],
      patch: { summary: `Update ${t.name}`, requestBody: body, responses },
      delete: { summary: `Delete ${t.name}`, responses },
    };
  }
  for (const op of operations)
    paths[`/rpc/${op.name}`] = {
      post: {
        summary: `Reviewed ${op.kind} operation`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: Object.keys(op.args),
                properties: Object.fromEntries(
                  Object.entries(op.args).map(([name, type]) => [name, { type }]),
                ),
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': { description: 'Policy-checked result' },
          '400': error,
          '401': error,
          '403': error,
          '404': error,
        },
      },
    };
  return {
    openapi: '3.1.0',
    info: {
      title: 'QB Flex project API',
      version: String(version),
      description:
        'Project key identifies the realm. Application sessions and row policies grant access.',
    },
    servers: [{ url }],
    security: [{ publishableKey: [] }],
    components: {
      securitySchemes: {
        publishableKey: { type: 'apiKey', in: 'header', name: 'x-qb-key' },
        applicationSession: { type: 'http', scheme: 'bearer' },
      },
      schemas,
    },
    paths,
  };
}
