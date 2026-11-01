import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const resource = new URL('../content/bulkimport.xhtml', import.meta.url)
const importer = readFileSync(new URL('../content/folder-import.ts', import.meta.url), 'utf8')
const controller = readFileSync(new URL('../content/bulkimport.ts', import.meta.url), 'utf8')

test('modern Zotero opens an XHTML chrome resource, not an unsupported XUL download', () => {
  assert.ok(existsSync(resource), 'bulkimport.xhtml must be shipped')
  assert.ok(importer.includes('chrome://zotero-folder-import/content/bulkimport.xhtml'))
  assert.ok(!importer.includes('content/bulkimport.xul'))
})

test('the native dialog is a child of a XUL window in the XHTML resource', () => {
  assert.ok(existsSync(resource), 'modern dialog resource must exist')
  const markup = readFileSync(resource, 'utf8')
  assert.match(markup, /<window\b[\s\S]*?<dialog\b/)
  assert.match(markup, /<\/dialog>\s*<\/window>/)
  assert.ok(!/ondialog(?:accept|cancel)\s*=/.test(markup), 'legacy event attributes are unsupported')
})

test('dialog buttons dispatch registered accept and cancel listeners', () => {
  assert.match(controller, /document\.addEventListener\('dialogaccept', onAccept\)/)
  assert.match(controller, /document\.addEventListener\('dialogcancel', onCancel\)/)
})
