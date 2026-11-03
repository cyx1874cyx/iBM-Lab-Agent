export interface DshRagCommandInput {
  readonly knowledgeBaseNames: readonly string[]
  readonly question: string
}

function readQuotedName(input: string): { readonly name: string; readonly rest: string } | undefined {
  if (!input.startsWith('@"')) return undefined
  let escaped = false
  for (let index = 2; index < input.length; index += 1) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char !== '"') continue
    const literal = input.slice(1, index + 1)
    let name: unknown
    try {
      name = JSON.parse(literal)
    } catch {
      throw new Error('知识库选择格式无效；请使用 @"知识库名称"。')
    }
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('知识库名称不能为空。')
    }
    return { name: name.trim(), rest: input.slice(index + 1).trimStart() }
  }
  throw new Error('知识库选择缺少结束引号；请使用 @"知识库名称"。')
}

function readBareName(input: string): { readonly name: string; readonly rest: string } | undefined {
  if (!input.startsWith('@')) return undefined
  const match = /^@([^\s]+)(?:\s+|$)/u.exec(input)
  if (match === null || match[1] === undefined) return undefined
  return { name: match[1], rest: input.slice(match[0].length) }
}

/** Parse optional leading knowledge-base selectors from `/rag` arguments. */
export function parseDshRagCommandInput(rawInput: string): DshRagCommandInput {
  let rest = rawInput.trim()
  const names: string[] = []
  while (rest.startsWith('@')) {
    const selected = readQuotedName(rest) ?? readBareName(rest)
    if (selected === undefined) throw new Error('知识库选择格式无效；请使用 @"知识库名称"。')
    names.push(selected.name)
    rest = selected.rest.trimStart()
  }
  return {
    knowledgeBaseNames: [...new Set(names)],
    question: rest.trim(),
  }
}

/** Produce the shortest unambiguous selector inserted by the Web slash menu. */
export function formatKnowledgeBaseSelector(name: string): string {
  return /^@?[^\s"\\]+$/u.test(name) ? `@${name.replace(/^@/u, '')} ` : `@${JSON.stringify(name)} `
}
