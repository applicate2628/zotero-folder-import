import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../content/folder-import.ts', import.meta.url), 'utf8')
const start = source.indexOf('class FolderScanner {')
const end = source.indexOf('export class $FolderImport', start)
assert.ok(start >= 0 && end > start, 'locate the actual FolderScanner implementation')

const scannerJs = transformSync(
  source.slice(start, end) + '\nglobalThis.FolderScannerForTests = FolderScanner;',
  { loader: 'ts', target: 'es2022' },
).code

function scannerFor(includeSubfolders) {
  const contents = new Map([
    ['/root', ['/root/article.pdf', '/root/sub']],
    ['/root/sub', ['/root/sub/notes.pdf', '/root/sub/nested']],
    ['/root/sub/nested', ['/root/sub/nested/research.pdf']],
  ])
  const context = {
    IOUtils: {
      getChildren: async path => contents.get(path) ?? [],
      stat: async path => ({ type: contents.has(path) ? 'directory' : 'regular' }),
    },
    PathUtils: { filename: path => path.slice(path.lastIndexOf('/') + 1) },
    log: { info() {} },
  }
  vm.runInNewContext(scannerJs, context)
  return new context.FolderScannerForTests('/root', true, includeSubfolders)
}

test('when checkbox is clear, only root files are scanned and counted', async () => {
  const scanner = scannerFor(false)
  await scanner.scan()
  assert.equal(scanner.selected(new Set(['pdf'])), 1)
  assert.equal(scanner.folders.length, 0)
})

test('when checkbox is checked, nested PDFs are included exactly once', async () => {
  const scanner = scannerFor(true)
  await scanner.scan()
  assert.equal(scanner.selected(new Set(['pdf'])), 3)
  assert.equal(scanner.folders.length, 1)
  assert.equal(scanner.folders[0].folders.length, 1)
})

test('the import UI exposes a real checkbox with an unchecked default', () => {
  assert.match(source, /Services\.prompt\.confirmCheck\(/)
  assert.match(source, /'Include subfolders'/)
  assert.match(source, /const includeSubfolders = \{ value: false \}/)
})
