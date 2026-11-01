import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../content/folder-import.ts', import.meta.url), 'utf8')
const start = source.indexOf('function fileSystemPath(')
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
    PathUtils: { filename: path => path.slice(path.lastIndexOf('/') + 1), join: (root, name) => root + '/' + name },
    log: { info() {} },
    sleep: async () => {},
  }
  const imports = []
  const created = []
  class Collection {
    constructor() {
      this.id = created.length + 1
      this.key = 'collection-' + this.id
    }
    getChildCollections() { return [] }
    async saveTx() { created.push(this) }
    async loadAllData() {}
  }
  context.Zotero = {
    Collection,
    Collections: { getByLibrary: () => [] },
    Attachments: {
      importFromFile: async ({ file }) => { imports.push(file); return { file } },
      linkFromFile: async ({ file }) => { imports.push(file); return { file } },
    },
  }
  vm.runInNewContext(scannerJs, context)
  const scanner = new context.FolderScannerForTests('/root', true, includeSubfolders)
  scanner.testImports = imports
  scanner.testCollections = created
  return scanner
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

test('the import UI exposes one native dialog with a checkbox defaulting off', () => {
  const markup = readFileSync(new URL('../content/bulkimport.xhtml', import.meta.url), 'utf8')
  assert.match(source, /openDialog\(/)
  assert.match(source, /includeSubfolders: false/)
  assert.match(markup, /id="folder-import-include-subfolders"/)
})

test('import without recursion writes only the top-level document', async () => {
  const scanner = scannerFor(true)
  await scanner.scan()
  const params = {
    extensions: new Set(['pdf']),
    link: false,
    includeSubfolders: false,
    libraryID: 1,
    progress: { update() {} },
  }
  assert.equal(scanner.selected(params.extensions, false), 1)
  await scanner.import(params, null, [], new Set())
  assert.deepEqual(scanner.testImports, ['/root/article.pdf'])
  assert.equal(scanner.testCollections.length, 0)
})

test('recursive import preserves nested collection hierarchy', async () => {
  const scanner = scannerFor(true)
  await scanner.scan()
  const params = {
    extensions: new Set(['pdf']),
    link: false,
    includeSubfolders: true,
    libraryID: 1,
    progress: { update() {} },
  }
  assert.equal(scanner.selected(params.extensions, true), 3)
  await scanner.import(params, null, [], new Set())
  assert.deepEqual(scanner.testImports, [
    '/root/article.pdf',
    '/root/sub/notes.pdf',
    '/root/sub/nested/research.pdf',
  ])
  assert.deepEqual(scanner.testCollections.map(item => [item.name, item.parentKey]), [
    ['sub', undefined],
    ['nested', 'collection-1'],
  ])
})
