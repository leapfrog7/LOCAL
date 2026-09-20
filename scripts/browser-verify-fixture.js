(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('local-vault', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const pageImage = (number, width, height) => {
    const rows = Array.from({ length: 12 }, (_, index) => `<text x="90" y="${300 + index * 105}" font-family="Arial" font-size="34" fill="#25352d">Page ${number} · inspection row ${index + 1} · complete readable content</text>`).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fffdf8"/><rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#176749" stroke-width="12"/><rect x="54" y="54" width="${width - 108}" height="150" rx="22" fill="#e1efe7"/><text x="90" y="150" font-family="Arial" font-size="56" font-weight="700" fill="#174d39">FULL PAGE ${number}</text>${rows}<rect x="54" y="${height - 190}" width="${width - 108}" height="130" rx="20" fill="#174d39"/><text x="90" y="${height - 105}" font-family="Arial" font-size="44" font-weight="700" fill="white">BOTTOM OF PAGE ${number} — VISIBLE</text></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  const thumbnail = (number) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="96"><rect width="72" height="96" fill="#efb9d1"/><text x="5" y="50" font-size="12">tiny ${number}</text></svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
  }
  const pages = Array.from({ length: 7 }, (_, index) => {
    const landscape = index === 2
    return {
      id: `visual-page-${index + 1}`,
      imageUrl: pageImage(index + 1, landscape ? 2000 : 1200, landscape ? 1200 : 2000),
      thumbnailUrl: thumbnail(index + 1),
      rotation: index === 4 ? 90 : 0,
      ocrText: `Full page ${index + 1} searchable text`,
      ocrState: 'complete'
    }
  })
  const now = new Date().toISOString()
  const document = { id: 'desktop-visual-verification', title: 'Desktop page verification', titleSource: 'manual', folder: 'Unfiled', createdAt: now, updatedAt: now, status: 'indexed', processingStage: 'complete', pages, tags: ['visual-check'] }
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('documents', 'readwrite')
    transaction.objectStore('documents').put(document)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
  return 'SEEDED'
})()
