import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const controllerSource = readFileSync(new URL('../content/bulkimport.ts', import.meta.url), 'utf8')
const importerSource = readFileSync(new URL('../content/folder-import.ts', import.meta.url), 'utf8')
const markup = readFileSync(new URL('../content/bulkimport.xhtml', import.meta.url), 'utf8')

function createNode(tag = 'div') {
  return {
    tag,
    id: '',
    value: '',
    textContent: '',
    disabled: false,
    checked: false,
    hidden: false,
    children: [],
    listeners: new Map(),
    addEventListener(event, listener) { this.listeners.set(event, listener) },
    fire(event) { this.listeners.get(event)?.({ target: this }) },
    setAttribute(name, value) { this[name] = value },
    appendChild(child) { this.children.push(child); return child },
    replaceChildren(...children) { this.children = children },
  }
}

function dialogHarness() {
  const ids = [
    'folder-import-extensions',
    'folder-import-include-subfolders',
    'folder-import-copy',
    'folder-import-link',
    'folder-import-error',
  ]
  const elements = Object.fromEntries(ids.map(id => [id, { ...createNode(), id }]))
  const params = {
    allExtensions: ['pdf', 'docx', 'md'],
    rootExtensions: ['pdf', 'docx'],
    extensions: new Set(['pdf', 'docx', 'md']),
    canLink: true,
    link: false,
    includeSubfolders: false,
    confirmed: false,
  }
  const doc = {
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler) },
    getElementById(id) { return elements[id] },
    createElementNS(_namespace, tag) { return createNode(tag) },
  }
  const script = transformSync(controllerSource, { loader: 'ts', target: 'es2022', format: 'cjs' }).code
  const fits = []
  elements['folder-import-error'].hidden = true
  const win = {
    arguments: [params],
    sizeToContent() {
      fits.push({ types: elements['folder-import-extensions'].children.length, error: !elements['folder-import-error'].hidden })
    },
  }
  const context = { document: doc, window: win, module: { exports: {} }, exports: {} }
  context.exports = context.module.exports
  vm.runInNewContext(script, context)
  for (const name of ['onLoad', 'onAccept', 'onCancel']) {
    context[name] = context.module.exports[name]
  }
  return { elements, params, context, fits }
}

function types(elements) {
  return elements['folder-import-extensions'].children.map(label => {
    const input = label.children.find(child => child.tag === 'input')
    return { name: input?.value, checked: input?.checked, input }
  })
}

test('one native dialog replaces the two prompt windows', () => {
  assert.match(importerSource, /openDialog\(/)
  assert.match(importerSource, /content\/bulkimport\.xhtml/)
  assert.doesNotMatch(importerSource, /Services\.prompt\.(prompt|confirmCheck)\(/)
  assert.match(markup, /folder-import-include-subfolders/)
  assert.match(markup, /content\/bulkimport\.js/)
  assert.doesNotMatch(markup, /zotero-better-bibtex/)
})

test('recursive option defaults off; toggling exposes nested-only file types', () => {
  const { elements, context } = dialogHarness()
  context.onLoad()
  assert.deepEqual(types(elements).map(t => t.name), ['pdf', 'docx'])
  const nested = elements['folder-import-include-subfolders']
  assert.equal(nested.checked, false)
  nested.checked = true
  nested.fire('change')
  assert.deepEqual(types(elements).map(t => t.name), ['pdf', 'docx', 'md'])
})

test('file-type choices survive toggling, selected options are committed atomically', () => {
  const { elements, context, params } = dialogHarness()
  context.onLoad()
  const unchecked = types(elements).find(t => t.name === 'docx')
  unchecked.input.checked = false
  unchecked.input.fire('change')
  elements['folder-import-include-subfolders'].checked = true
  elements['folder-import-include-subfolders'].fire('change')
  assert.equal(types(elements).find(t => t.name === 'docx').checked, false)
  elements['folder-import-link'].checked = true
  const event = { prevented: false, preventDefault() { this.prevented = true } }
  context.onAccept(event)
  assert.equal(event.prevented, false)
  assert.equal(params.confirmed, true)
  assert.equal(params.link, true)
  assert.equal(params.includeSubfolders, true)
  assert.deepEqual([...params.extensions].sort(), ['md', 'pdf'])
})

test('cancel keeps existing import options unchanged', () => {
  const { elements, context, params } = dialogHarness()
  context.onLoad()
  elements['folder-import-include-subfolders'].checked = true
  elements['folder-import-include-subfolders'].fire('change')
  context.onCancel()
  assert.equal(params.confirmed, false)
  assert.equal(params.includeSubfolders, false)
  assert.deepEqual([...params.extensions].sort(), ['docx', 'md', 'pdf'])
})

test('import without selected file types is blocked with inline explanation', () => {
  const { elements, context, params } = dialogHarness()
  context.onLoad()
  for (const { input } of types(elements)) {
    input.checked = false
    input.fire('change')
  }
  const event = { prevented: false, preventDefault() { this.prevented = true } }
  context.onAccept(event)
  assert.equal(event.prevented, true)
  assert.equal(params.confirmed, false)
  assert.equal(elements['folder-import-error'].hidden, false)
})


test('the window fits the complete grid after subfolders add a second row', () => {
  const { elements, context, params, fits } = dialogHarness()
  params.allExtensions = ['docx', 'md', 'pdf', 'png', 'pptx']
  params.rootExtensions = ['pdf']
  params.extensions = new Set(params.allExtensions)
  context.onLoad()
  const before = fits.length
  const recurse = elements['folder-import-include-subfolders']
  recurse.checked = true
  recurse.fire('change')
  assert.equal(types(elements).length, 5)
  assert.ok(fits.length > before, 'new content must refit the native window')
  assert.equal(fits.at(-1).types, 5, 'measure after all five options are inserted')
  recurse.checked = false
  recurse.fire('change')
  assert.equal(fits.at(-1).types, 1)
})

test('showing and clearing validation errors keeps the action buttons in view', () => {
  const { elements, context, fits } = dialogHarness()
  context.onLoad()
  for (const { input } of types(elements)) {
    input.checked = false
    input.fire('change')
  }
  context.onAccept({ preventDefault() {} })
  assert.equal(fits.at(-1)?.error, true, 'fit after showing the validation message')
  const input = types(elements)[0].input
  input.checked = true
  input.fire('change')
  assert.equal(fits.at(-1)?.error, false, 'fit after clearing the validation message')
})
