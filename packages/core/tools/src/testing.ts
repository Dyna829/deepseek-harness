/**
 * @file Tool 注册表测试用的标准 fixture。
 *
 * 仓库里的测试需要「一个能跑、有可读返回值」的 tool；本文件提供的
 * `defineContentToolFixture` 让测试代码以**和正式 tool 一样的注册方式**声明
 * 一个 fixture（不是绕开 `defineTool`）。
 *
 * 注意：fixture 故意让 content blocks 当 canonical JSON value（生产 tool **不应该**
 * 这么干，必须声明自己的 DTO 输出）。这是测试的「最快造一个能跑的 tool」的方式。
 */

/** Canonical tool-definition fixtures for repository tests. @module dsh-tools/testing */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from './schema.ts'
import type { DefineToolOptions, ParameterSchemaSpec } from './schema.ts'
import type { ToolDefinition, ToolRunContext } from './index.ts'

const CONTENT_VALUE_SCHEMA = { type: 'array', items: { type: 'json' } } as const

/** Options for a fixture whose canonical value is its rendered content array. */
export type ContentToolFixtureOptions<S extends ParameterSchemaSpec> = Omit<
  DefineToolOptions<S, typeof CONTENT_VALUE_SCHEMA>,
  'output' | 'execute'
> & {
  /** Produce the fixture's content blocks as its canonical test value. */
  execute(args: import('./schema.ts').InferArgs<S>, exec: ToolRunContext): Promise<ContentBlock[]>
}

/**
 * Define a test fixture that deliberately uses its content blocks as the
 * canonical JSON value. Product tools must declare domain-owned DTOs instead.
 * @param options - ordinary fixture fields plus a content-producing body.
 * @returns a registry-ready tool with an explicit JSON-array output contract.
 * @internal
 */
export function defineContentToolFixture<const S extends ParameterSchemaSpec>(
  options: ContentToolFixtureOptions<S>,
): ToolDefinition {
  // oxlint-disable-next-line typescript/unbound-method
  const execute = options.execute
  return defineTool({
    ...options,
    output: {
      schema: CONTENT_VALUE_SCHEMA,
      render: (_args, value) => value as unknown as ContentBlock[],
    },
    async execute(args, exec) {
      return await execute(args, exec) as unknown as JsonValue[]
    },
  })
}
