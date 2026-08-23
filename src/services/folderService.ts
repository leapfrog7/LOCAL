import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'
import { sqliteRepository } from './sqliteRepository'

const KEY = 'local.folders'
const RESERVED = 'Unfiled'

function clean(name: string) {
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value) throw new Error('Enter a folder name.')
  if (value.length > 48) throw new Error('Folder names can contain up to 48 characters.')
  return value
}

function webFolders() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] }
}

async function storeFolders(folders: string[]) {
  if (sqliteRepository.available()) {
    const existing = await sqliteRepository.listFolders()
    await Promise.all(folders.filter(name => !existing.includes(name)).map(name => sqliteRepository.createFolder(name)))
  } else localStorage.setItem(KEY, JSON.stringify(folders))
}

export const folderService = {
  async list(documents: VaultDocument[]) {
    const stored = sqliteRepository.available() ? await sqliteRepository.listFolders() : webFolders()
    return [...new Set([RESERVED, ...stored, ...documents.map(document => document.folder)])].sort((a, b) => a === RESERVED ? -1 : b === RESERVED ? 1 : a.localeCompare(b))
  },

  async create(name: string, documents: VaultDocument[]) {
    const value = clean(name), folders = await this.list(documents)
    if (folders.some(folder => folder.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new Error('A folder with that name already exists.')
    await storeFolders([...folders, value])
    return value
  },

  async rename(name: string, nextName: string, documents: VaultDocument[]) {
    if (name === RESERVED) throw new Error('Unfiled cannot be renamed.')
    const value = clean(nextName), folders = await this.list(documents)
    if (folders.some(folder => folder !== name && folder.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new Error('A folder with that name already exists.')
    for (const document of documents.filter(document => document.folder === name)) await documentsRepository.save({ ...document, folder: value, updatedAt: new Date().toISOString() })
    await storeFolders([...folders.filter(folder => folder !== name), value])
    if (sqliteRepository.available()) await sqliteRepository.removeFolder(name)
    else localStorage.setItem(KEY, JSON.stringify(webFolders().filter(folder => folder !== name)))
    return value
  },

  async remove(name: string, documents: VaultDocument[]) {
    if (name === RESERVED) throw new Error('Unfiled cannot be removed.')
    for (const document of documents.filter(document => document.folder === name)) await documentsRepository.save({ ...document, folder: RESERVED, updatedAt: new Date().toISOString() })
    if (sqliteRepository.available()) await sqliteRepository.removeFolder(name)
    else localStorage.setItem(KEY, JSON.stringify(webFolders().filter(folder => folder !== name)))
  },
}
