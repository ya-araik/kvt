#!/usr/bin/env node
import { generateArtifact, generatorKinds, runDoctor, type GeneratorKind } from './index.js'

const [command, ...arguments_] = process.argv.slice(2)

if (command === 'doctor') {
  const checks = await runDoctor(arguments_[0])
  for (const check of checks) console.log(`${symbol(check.status)} ${check.name}: ${check.message}`)
  if (checks.some((check) => check.status === 'failure')) process.exitCode = 1
} else if (command === 'generate') {
  const [kind, name, directory] = arguments_
  if (!kind || !generatorKinds.includes(kind as GeneratorKind) || !name) {
    console.error(`Usage: kvt generate <${generatorKinds.join('|')}> <name> [directory]`)
    process.exitCode = 2
  } else {
    console.log(await generateArtifact(kind as GeneratorKind, name, directory))
  }
} else {
  console.log('Usage: kvt <doctor|generate>')
  if (command) process.exitCode = 2
}

function symbol(status: 'pass' | 'warning' | 'failure'): string {
  return status === 'pass' ? '✓' : status === 'warning' ? '!' : '✗'
}
