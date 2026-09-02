import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ProjectTemplate = 'core' | 'spa' | 'ssr'
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface CreateProjectOptions {
  readonly packageManager?: PackageManager
  readonly kvtVersion?: string
}

const templatesDirectory = fileURLToPath(new URL('../templates/', import.meta.url))

export async function createProject(
  directory: string,
  template: ProjectTemplate,
  options: CreateProjectOptions = {}
): Promise<string> {
  const target = resolve(directory)
  const projectName = basename(target).replaceAll(/[^a-zA-Z0-9._-]/g, '-')
  if (!projectName) throw new TypeError('Project directory must have a valid final path segment')
  await assertEmptyTarget(target)

  const layers = template === 'ssr' ? ['shared-todo', 'spa', 'ssr'] : ['shared-todo', template]
  const files = new Map<string, string>()
  for (const layer of layers) {
    const root = join(templatesDirectory, layer)
    for (const path of await collectFiles(root)) {
      files.set(relative(root, path), await readFile(path, 'utf8'))
    }
  }

  const replacements: Readonly<Record<string, string>> = {
    __PROJECT_NAME__: projectName,
    __KVT_VERSION__: options.kvtVersion ?? '1.0.0',
    __PACKAGE_MANAGER__: options.packageManager ?? detectPackageManager()
  }
  for (const [path, source] of files) {
    const output = join(target, path)
    await mkdir(dirname(output), { recursive: true })
    const contents = Object.entries(replacements).reduce(
      (current, [placeholder, value]) => current.replaceAll(placeholder, value),
      source
    )
    await writeFile(output, contents, { encoding: 'utf8', flag: 'wx' })
  }
  return target
}

async function assertEmptyTarget(target: string): Promise<void> {
  try {
    const existing = await readdir(target)
    if (existing.length > 0) throw new Error(`Refusing to create a project in non-empty directory: ${target}`)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}

async function collectFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function detectPackageManager(): PackageManager {
  const agent = process.env.npm_config_user_agent?.split('/')[0]
  return agent === 'pnpm' || agent === 'yarn' || agent === 'bun' ? agent : 'npm'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
