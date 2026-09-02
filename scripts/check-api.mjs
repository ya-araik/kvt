import { Extractor, ExtractorConfig } from '@microsoft/api-extractor'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(repository, 'packages')
const reportRoot = join(repository, 'etc')
const temporaryRoot = join(repository, 'temp', 'api-reports')
const update = process.env.API_REPORT_UPDATE === '1'

await mkdir(reportRoot, { recursive: true })
await mkdir(temporaryRoot, { recursive: true })

let failed = false
for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const projectFolder = join(packageRoot, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(projectFolder, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  if (manifest.private) continue
  const unscopedName = String(manifest.name).replace(/^@[^/]+\//, '')
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder,
      mainEntryPointFilePath: '<projectFolder>/dist/index.d.ts',
      compiler: { tsconfigFilePath: '<projectFolder>/tsconfig.json' },
      apiReport: {
        enabled: true,
        reportFileName: `${unscopedName}.api.md`,
        reportFolder: reportRoot,
        reportTempFolder: temporaryRoot
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: { logLevel: 'warning' } },
        extractorMessageReporting: {
          default: { logLevel: 'warning' },
          'ae-missing-release-tag': { logLevel: 'none' },
          'ae-undocumented': { logLevel: 'none' }
        },
        tsdocMessageReporting: { default: { logLevel: 'warning' } }
      }
    },
    configObjectFullPath: join(projectFolder, 'api-extractor.json'),
    packageJsonFullPath: join(projectFolder, 'package.json')
  })
  const result = Extractor.invoke(config, {
    localBuild: update,
    showVerboseMessages: false,
    showDiagnostics: false,
    messageCallback: (message) => {
      if (message.logLevel === 'none') message.handled = true
    }
  })
  if (!result.succeeded) {
    failed = true
    console.error(`${manifest.name}: API report failed with ${result.errorCount} errors and ${result.warningCount} warnings`)
  } else {
    console.log(`${manifest.name}: API report ${update ? 'updated' : 'verified'}`)
  }
}

if (failed) process.exitCode = 1
