import type { DocumentSmartMetadata, SmartDocumentType, VaultDocument } from '../domain/types'

const clean = (value: string) => value.replace(/[|<>]/g, ' ').replace(/\s+/g, ' ').trim()
const useful = (line: string) => line.length >= 3 && /[A-Za-z\u0900-\u097f]{2}/.test(line) && !/^\d+[\s./-]*$/.test(line)
const clipped = (value: string) => clean(value).slice(0, 90).replace(/[.,;:—-]+$/, '')
const valueAfterLabel = (line: string) => clean(line.replace(/^[^:：-]+\s*[:：-]\s*/, ''))

const TYPE_RULES: { type: SmartDocumentType; label: string; pattern: RegExp }[] = [
  { type: 'electricity_bill', label: 'Electricity Bill', pattern: /\b(electricity|power)\s+bill\b|बिजली\s*(?:का\s*)?बिल|विद्युत\s*(?:देयक|बिल)/i },
  { type: 'water_bill', label: 'Water Bill', pattern: /\bwater\s+bill\b|जल\s*(?:कर|बिल)|पानी\s*(?:का\s*)?बिल/i },
  { type: 'phone_bill', label: 'Phone Bill', pattern: /\b(?:mobile|phone|telephone|broadband)\s+bill\b|दूरभाष\s*(?:देयक|बिल)/i },
  { type: 'bank_statement', label: 'Bank Statement', pattern: /\b(?:bank|account|credit card)\s+statement\b|खाता\s+विवरण/i },
  { type: 'prescription', label: 'Prescription', pattern: /\bprescription\b|\brx\b|चिकित्सकीय\s+पर्चा|दवा\s+की\s+पर्ची/i },
  { type: 'insurance_policy', label: 'Insurance Policy', pattern: /\binsurance\s+policy\b|बीमा\s+पॉलिसी/i },
  { type: 'invoice', label: 'Invoice', pattern: /\b(?:tax\s+|proforma\s+)?invoice\b|बीजक|कर\s+चालान/i },
  { type: 'receipt', label: 'Receipt', pattern: /\b(?:payment\s+)?receipt\b|रसीद/i },
  { type: 'office_memorandum', label: 'Office Memorandum', pattern: /\boffice memorandum\b|कार्यालय\s+ज्ञापन/i },
  { type: 'circular', label: 'Circular', pattern: /\bcircular\b|परिपत्र/i },
  { type: 'notification', label: 'Notification', pattern: /\bnotification\b|अधिसूचना/i },
  { type: 'order', label: 'Order', pattern: /^\s*(?:office\s+)?order\b|^\s*आदेश\b/im },
  { type: 'letter', label: 'Letter', pattern: /\b(?:official|business)\s+letter\b|औपचारिक\s+पत्र/i },
]

const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function parsedDate(value: string) {
  const numeric = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/)
  if (numeric) {
    const day = Number(numeric[1]), month = Number(numeric[2]), year = Number(numeric[3]) + (numeric[3].length === 2 ? 2000 : 0)
    if (validDate(year, month, day)) return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, label: `${day} ${MONTH_LABELS[month - 1]} ${year}` }
  }
  const dayFirst = value.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(\d{4})\b/i)
  const monthFirst = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i)
  if (dayFirst || monthFirst) {
    const day = Number(dayFirst?.[1] ?? monthFirst?.[2]), monthName = dayFirst?.[2] ?? monthFirst?.[1] ?? '', year = Number(dayFirst?.[3] ?? monthFirst?.[3])
    const month = MONTHS[monthName.toLowerCase()]
    if (month && validDate(year, month, day)) return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, label: `${day} ${MONTH_LABELS[month - 1]} ${year}` }
  }
  const monthYear = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i)
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()], year = Number(monthYear[2])
    return { iso: `${year}-${String(month).padStart(2, '0')}`, label: `${monthYear[1][0].toUpperCase()}${monthYear[1].slice(1).toLowerCase()} ${year}` }
  }
}

function extractDate(lines: string[]) {
  const preferred = lines.filter(line => /(?:invoice|bill|issue|document)?\s*date|दिनांक|तिथि/i.test(line) && !/(?:due|expiry|valid until|देय)/i.test(line))
  for (const line of [...preferred, ...lines]) { const date = parsedDate(line); if (date) return date }
}

function extractAmount(lines: string[]) {
  const preferred = lines.filter(line => /grand\s+total|total\s+amount|amount\s+(?:due|payable)|net\s+amount|कुल\s*(?:राशि|देय)|देय\s+राशि/i.test(line))
  for (const line of [...preferred, ...lines]) {
    const match = line.match(/(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(₹|Rs\.?|INR|USD|EUR|GBP)\b/i)
    if (!match) continue
    const token = match[0], value = Number((match[1] ?? match[2]).replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const currency: 'INR' | 'USD' | 'EUR' | 'GBP' = /\$|USD/i.test(token) ? 'USD' : /€|EUR/i.test(token) ? 'EUR' : /£|GBP/i.test(token) ? 'GBP' : 'INR'
    const symbol = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[currency]
    const display = `${symbol}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`
    return { value, currency, display }
  }
}

function extractIdentifier(lines: string[]) {
  const rules: { type: NonNullable<DocumentSmartMetadata['identifier']>['type']; pattern: RegExp }[] = [
    { type: 'invoice', pattern: /(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
    { type: 'bill', pattern: /bill\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
    { type: 'receipt', pattern: /receipt\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
    { type: 'policy', pattern: /policy\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
    { type: 'order', pattern: /order\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
    { type: 'reference', pattern: /(?:reference|ref)\s*(?:number|no\.?|#)\s*[:：-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i },
  ]
  for (const line of lines) for (const rule of rules) { const match = line.match(rule.pattern); if (match) return { type: rule.type, value: match[1] } }
}

function extractOrganization(lines: string[], type?: SmartDocumentType) {
  for (const line of lines.slice(0, 12)) {
    if (/^(?:vendor|seller|merchant|company|hospital|clinic|issued by|from)\s*[:：-]/i.test(line)) return clipped(valueAfterLabel(line))
  }
  const candidates = lines.slice(0, 10).filter(line => {
    if (line.length < 3 || line.length > 70 || /subject|विषय|date|दिनांक|invoice|receipt|statement|policy|memorandum|circular|notification|amount|total|address|फोन|मोबाइल/i.test(line)) return false
    if (/\b\d{4,}\b|@|www\.|https?:|^[\W\d_]+$/i.test(line)) return false
    return /\b(?:pvt\.?\s*ltd\.?|private limited|limited|ltd\.?|bank|hospital|clinic|medical|corporation|company|department|ministry|board|amazon|flipkart|reliance|airtel|jio)\b/i.test(line) || /^(?:dr\.?|doctor)\s+[A-Za-z]/i.test(line)
  })
  if (type === 'prescription') return candidates.find(line => /^(?:dr\.?|doctor)\s+/i.test(line)) ?? candidates[0]
  return candidates[0]
}

function composeTitle(typeLabel: string | undefined, metadata: DocumentSmartMetadata) {
  let lead = typeLabel
  if (metadata.organization) lead = lead && !metadata.organization.toLowerCase().includes(lead.toLowerCase()) ? `${metadata.organization} ${lead}` : metadata.organization
  const details: string[] = []
  if (metadata.amount) details.push(metadata.amount.display)
  if (metadata.dateLabel) details.push(metadata.dateLabel)
  if (!metadata.amount && metadata.identifier) details.push(`${metadata.identifier.type === 'reference' ? 'Ref' : 'No.'} ${metadata.identifier.value}`)
  return lead ? clipped([lead, ...details].join(' · ')) : undefined
}

export function fallbackDocumentTitle(date: Date) {
  const two = (value: number) => String(value).padStart(2, '0')
  return `Scanned Document - ${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()} ${two(date.getHours())}-${two(date.getMinutes())}`
}

export interface DocumentTitleSuggestion { title: string; metadata: DocumentSmartMetadata }

export function suggestDocumentTitle(document: Pick<VaultDocument, 'pages' | 'createdAt'>): DocumentTitleSuggestion {
  const lines = document.pages.flatMap(page => page.ocrText.split(/\r?\n/).map(clean)).filter(useful)
  const subject = lines.find(line => /^(subject|sub\.?|विषय)\s*[:：-]/i.test(line))
  const fullText = lines.join('\n')
  const matchedType = TYPE_RULES.find(rule => rule.pattern.test(fullText))
  const date = extractDate(lines)
  const metadata: DocumentSmartMetadata = {
    documentType: matchedType?.type,
    organization: extractOrganization(lines, matchedType?.type),
    ...(date && { documentDate: date.iso, dateLabel: date.label }),
    amount: ['invoice', 'receipt', 'electricity_bill', 'water_bill', 'phone_bill', 'insurance_policy'].includes(matchedType?.type ?? '') ? extractAmount(lines) : undefined,
    identifier: extractIdentifier(lines),
  }
  if (subject) return { title: clipped(subject.replace(/^(subject|sub\.?|विषय)\s*[:：-]\s*/i, '')), metadata }
  const smartTitle = composeTitle(matchedType?.label, metadata)
  if (smartTitle) return { title: smartTitle, metadata }
  const heading = lines.find(line => /^(office memorandum|memorandum|order|circular|notification|letter|कार्यालय ज्ञापन|आदेश|परिपत्र)/i.test(line))
  if (heading) { const detail = lines.find(line => line !== heading && line.length > 12); return { title: clipped(detail ? `${heading} — ${detail}` : heading), metadata } }
  const first = lines.find(line => line.length >= 8 && line.length <= 120)
  return { title: first ? clipped(first) : fallbackDocumentTitle(new Date(document.createdAt)), metadata }
}

export function generateDocumentTitle(document: Pick<VaultDocument, 'pages' | 'createdAt'>) { return suggestDocumentTitle(document).title }
