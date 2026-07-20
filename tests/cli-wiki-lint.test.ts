/// <reference types="vitest/globals" />
import { readFileSync } from 'fs'
import * as path from 'path'

describe('cli wiki-lint command', () => {
  test('registers .command("wiki-lint") on the CLI program', () => {
    const cliSrc = readFileSync(path.join(__dirname, '../src/cli.ts'), 'utf-8')
    expect(cliSrc).toMatch(/\.command\(\s*["']wiki-lint["']\s*\)/)
    // Must not attach lint action to root program without a named command
    const withoutComments = cliSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const match = withoutComments.match(/\.command\(\s*["']wiki-lint["']\s*\)/)
    expect(match).toBeTruthy()
    const wikiLintIdx = match ? withoutComments.indexOf(match[0]) : -1
    expect(wikiLintIdx).toBeGreaterThan(-1)
    const after = withoutComments.slice(wikiLintIdx, wikiLintIdx + 400)
    expect(after).toMatch(/\.description\(\s*["']Wiki 구조 lint/)
  })
})
