import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const documentation = [join(root, 'README.md'), ...await markdownFiles(join(root, 'docs')), ...await markdownFiles(join(root, 'website'))]
const migrationFiles = new Set([
  join(root, 'docs', 'v1-implementation-plan.md'),
  join(root, 'docs', 'di-viewmodel-v2-implementation-plan.md'),
  join(root, 'website', 'reference', 'prototype-migration.md')
])
const legacy = /\b(?:provideSingleton|provideScoped|provideTransient|provideAsyncSingleton|provideAsyncScoped|provideAsyncTransient|provideAlias|provideValue|createViewModelKey|defineViewModel|KvtViewModelScope)\b|\b(?:scope|viewModelOwner)\s*:\s*(?:['"]route['"]|true)/u

for (const path of documentation) {
  const source = await readFile(path, 'utf8')
  if (!migrationFiles.has(path) && legacy.test(source)) {
    throw new Error(`${path} references removed prototype APIs outside the migration ledger`)
  }
  for (const [index, code] of fencedTypeScript(source).entries()) {
    const candidates = [
      code,
      `class DocumentationSnippet {\n${code}\n}`,
      `async function documentationSnippet() {\n${code}\n}`,
      `const documentationSnippet = <>\n${code}\n</>`
    ]
    const results = candidates.map((candidate) => ts.transpileModule(candidate, {
      fileName: 'snippet.tsx',
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      reportDiagnostics: true
    }))
    const syntaxErrors = results
      .map((result) => (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))
      .sort((left, right) => left.length - right.length)[0] ?? []
    if (syntaxErrors.length > 0) {
      const message = syntaxErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')
      throw new Error(`${path}: TypeScript snippet ${index + 1} is invalid: ${message}`)
    }
  }
  if (path.startsWith(join(root, 'website'))) {
    for (const match of source.matchAll(/\]\((\/[a-z0-9/_-]+)(?:#[^)]+)?\)/giu)) {
      const target = match[1]
      if (!target || target === '/api/' || target.startsWith('/api/')) continue
      const page = join(root, 'website', `${target.replace(/^\//u, '')}.md`)
      try { await readFile(page, 'utf8') } catch { throw new Error(`${path} links to missing documentation page ${target}`) }
    }
  }
}

const todoModule = await readFile(join(root, 'packages/create-kvt/templates/spa/src/app/di/todo-module.ts'), 'utf8')
const todoPage = await readFile(join(root, 'packages/create-kvt/templates/spa/src/presentation/view/todo-page.tsx'), 'utf8')
const routes = await readFile(join(root, 'packages/create-kvt/templates/spa/src/app/navigation/routes.tsx'), 'utf8')
const domainFailures = await readFile(join(root, 'packages/create-kvt/templates/shared-todo/src/domain/model/failure/todo-use-case-failures.ts'), 'utf8')
const presentationModel = await readFile(join(root, 'packages/create-kvt/templates/spa/src/presentation/model/todo-list-state.ts'), 'utf8')
for (const required of ['bind(TodoRepository)', '.singleton()', 'bind(TodoListViewModel)', '.viewModel()']) {
  if (!todoModule.includes(required)) throw new Error(`Todo contract is missing ${required}`)
}
if (!todoPage.includes('useViewModel(TodoListViewModel)')) throw new Error('Todo UI does not use class-based ViewModel lookup')
if (!domainFailures.includes('AddTodoFailure')) throw new Error('Todo business failures must remain in domain/model/failure')
if (!presentationModel.includes('TodoUiError')) throw new Error('Todo UI errors must remain in presentation/model')
if (legacy.test(`${todoModule}\n${todoPage}\n${routes}`)) throw new Error('Todo template uses a removed prototype API')
if (/withKvtRoute|scope\s*:|viewModelOwner\s*:/u.test(routes)) throw new Error('Todo routes must remain ordinary RouteObjects')

console.log(`Documentation contracts passed for ${documentation.length} Markdown files.`)

function fencedTypeScript(source) {
  return [...source.matchAll(/```(?:ts|tsx|typescript)\s*\n([\s\S]*?)```/gu)].map((match) => match[1] ?? '')
}

async function markdownFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'public') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(path)
  }
  return result
}
