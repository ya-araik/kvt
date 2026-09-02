#!/usr/bin/env node
import { createProject, type ProjectTemplate } from './project.js'

const [directory, template = 'spa'] = process.argv.slice(2)
if (!directory || !['core', 'spa', 'ssr'].includes(template)) {
  console.error('Usage: create-kvt <directory> [core|spa|ssr]')
  process.exitCode = 2
} else {
  console.log(`Created ${await createProject(directory, template as ProjectTemplate)}`)
}
