type ImportOptions = {
  allExtensions: string[]
  rootExtensions: string[]
  extensions: Set<string>
  canLink: boolean
  link: boolean
  includeSubfolders: boolean
  confirmed: boolean
}

const html = 'http://www.w3.org/1999/xhtml'
let params: ImportOptions
let includeSubfolders = false
let selected: Map<string, boolean>

function element(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error('Folder Import: missing option ' + id)
  return node
}

function checkbox(id: string): HTMLInputElement {
  return element(id) as HTMLInputElement
}

function availableExtensions(): string[] {
  return includeSubfolders ? params.allExtensions : params.rootExtensions
}

function renderExtensions(): void {
  const container = element('folder-import-extensions')
  container.replaceChildren()

  const available = availableExtensions()
  if (available.length === 0) {
    const hint = document.createElementNS(html, 'span')
    hint.textContent = 'No files at this level. Enable Include subfolders.'
    container.appendChild(hint)
    return
  }

  for (const extension of available) {
    const label = document.createElementNS(html, 'label')
    label.setAttribute('style', 'display:flex; gap:7px; align-items:center; cursor:pointer;')
    const input = document.createElementNS(html, 'input') as HTMLInputElement
    input.type = 'checkbox'
    input.value = extension
    input.checked = selected.get(extension) !== false
    input.addEventListener('change', () => {
      selected.set(extension, input.checked)
      element('folder-import-error').hidden = true
    })
    const name = document.createElementNS(html, 'span')
    name.textContent = extension.toUpperCase()
    label.appendChild(input)
    label.appendChild(name)
    container.appendChild(label)
  }
}

export function onLoad(): void { // eslint-disable-line @typescript-eslint/no-unused-vars
  params = (window as Window & { arguments: [ImportOptions] }).arguments[0]
  selected = new Map(params.allExtensions.map(ext => [ext, params.extensions.has(ext)]))
  const recurse = checkbox('folder-import-include-subfolders')
  includeSubfolders = params.includeSubfolders
  recurse.checked = includeSubfolders
  recurse.addEventListener('change', () => {
    includeSubfolders = recurse.checked
    element('folder-import-error').hidden = true
    renderExtensions()
  })
  const linked = checkbox('folder-import-link')
  const copied = checkbox('folder-import-copy')
  linked.disabled = !params.canLink
  linked.checked = params.canLink && params.link
  copied.checked = !linked.checked
  renderExtensions()
}

export function onAccept(event: Event): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
  const extensions = availableExtensions().filter(ext => selected.get(ext) !== false)
  if (extensions.length === 0) {
    element('folder-import-error').hidden = false
    event.preventDefault()
    return false
  }
  params.extensions = new Set(extensions)
  params.includeSubfolders = checkbox('folder-import-include-subfolders').checked
  params.link = params.canLink && checkbox('folder-import-link').checked
  params.confirmed = true
  return true
}

export function onCancel(): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
  params.confirmed = false
  return true
}
