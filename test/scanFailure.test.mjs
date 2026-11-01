import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../content/folder-import.ts', import.meta.url), 'utf8')
const start = source.indexOf('function sleep(')
const end = source.indexOf('export var FolderImport')
const code = transformSync(source.slice(start, end).replace('export class $FolderImport', 'class $FolderImport') + '\nglobalThis.Scanner = FolderScanner; globalThis.Importer = $FolderImport;', {loader:'ts',target:'es2022'}).code

function harness(rootPath, children, stat) {
  const events = [], calls = [], alerts = []
  const context = {
    IOUtils: {
      getChildren: async path => { calls.push(['children',path]); return typeof children === 'function' ? children(path) : children },
      stat: async path => { calls.push(['stat',path]); return stat(path) },
    },
    PathUtils: {
      filename: path => path.split(/[\\/]/).pop(),
      join: (root,name) => root + (root.includes('\\') ? '\\' : '/') + name,
    },
    FilePickerHelper: class { async open() { return rootPath } },
    log: { info() {}, debug() {}, error() {} },
    Services: { prompt: { alert: (_parent,title,message) => { events.push('alert'); alerts.push({title,message}) } } },
    Zotero: {
      isWin: true,
      Schema: {schemaUpdatePromise:Promise.resolve()},
      getString: () => 'Import',
      getActiveZoteroPane: () => ({canEdit:()=>true,canEditFiles:()=>true,getSelectedCollection:()=>({id:1})}),
      showZoteroPaneProgressMeter: () => events.push('show'),
      hideZoteroPaneOverlays: () => events.push('hide'),
    },
  }
  vm.runInNewContext(code, context)
  return {context, events, calls, alerts}
}

test('long Windows path uses extended syntax for stat without changing the logical file path', async () => {
  const root = 'T:\\Books\\' + 'a'.repeat(120)
  const file = root + '\\' + 'b'.repeat(140) + '.djvu'
  const h=harness(root,[file], path => {
    if (!path.startsWith('\\\\?\\')) throw Object.assign(new Error('file does not exist'),{name:'NotFoundError'})
    return {type:'regular'}
  })
  const scanner=new h.context.Scanner(root,true,true)
  await scanner.scan()
  assert.deepEqual([...scanner.files],[file])
  assert.ok(h.calls.some(([kind,path])=>kind==='stat' && path==='\\\\?\\'+file))
})

test('long UNC folders retain share syntax and do not acquire duplicate prefixes', async () => {
  const root='\\\\server\\share\\'+'x'.repeat(250)
  const native='\\\\?\\UNC\\'+root.slice(2)
  const h=harness(root, path=>{
    assert.equal(path,native)
    return [native+'\\paper.pdf']
  }, path=>{assert.equal(path,native+'\\paper.pdf');return {type:'regular'}})
  const scanner=new h.context.Scanner(root,true,true)
  await scanner.scan()
  assert.deepEqual([...scanner.files],[root+'\\paper.pdf'])
})

test('already extended paths are not prefixed again', async () => {
  const root='\\\\?\\T:\\'+'z'.repeat(260)
  const h=harness(root,[root+'\\paper.pdf'],path=>{assert.equal(path,root+'\\paper.pdf');return {type:'regular'}})
  const scanner=new h.context.Scanner(root,true,true)
  await scanner.scan()
})

for (const name of ['NotFoundError','NotAllowedError']) {
  test(name + ' clears the scanning overlay and reports the path instead of hanging', async () => {
    const h=harness('T:\\Books', ()=>{throw Object.assign(new Error('Cannot read T:\\Books'),{name})},()=>({type:'regular'}))
    await new h.context.Importer().addAttachmentsFromFolder()
    assert.deepEqual(h.events,['show','hide','alert'])
    assert.equal(h.alerts.length,1)
    assert.match(h.alerts[0].message,/T:\\Books/)
  })
}
