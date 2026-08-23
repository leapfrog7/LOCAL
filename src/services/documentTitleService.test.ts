import { describe, expect, it } from 'vitest'
import { fallbackDocumentTitle, generateDocumentTitle, suggestDocumentTitle } from './documentTitleService'

const document = (text: string) => ({ createdAt: '2026-08-22T10:05:00.000Z', pages: [{ ocrText: text }] }) as never
describe('automatic document naming', () => {
  it('prefers English and Hindi subject lines', () => {
    expect(generateDocumentTitle(document('Government of India\nSubject: Sanction of expenditure\nSir'))).toBe('Sanction of expenditure')
    expect(generateDocumentTitle(document('भारत सरकार\nविषय: निदेशक की नियुक्ति'))).toBe('निदेशक की नियुक्ति')
  })
  it('uses a deterministic fallback', () => expect(fallbackDocumentTitle(new Date(2026, 7, 22, 15, 7))).toContain('22-08-2026 15-07'))

  it('names an invoice from its vendor, total and invoice date', () => {
    const suggestion = suggestDocumentTitle(document('Amazon Seller Services Pvt Ltd\nTAX INVOICE\nInvoice No: IN-48291\nInvoice Date: 22/08/2026\nGrand Total ₹1,249.00'))
    expect(suggestion.title).toBe('Amazon Seller Services Pvt Ltd Invoice · ₹1,249 · 22 Aug 2026')
    expect(suggestion.metadata.identifier).toEqual({ type: 'invoice', value: 'IN-48291' })
  })

  it('uses a billing month for utility bills', () => {
    expect(generateDocumentTitle(document('ELECTRICITY BILL\nBilling period: July 2026\nAmount due Rs. 980'))).toBe('Electricity Bill · ₹980 · July 2026')
  })

  it('recognizes a doctor and date on a prescription', () => {
    expect(generateDocumentTitle(document('Dr Sharma Clinic\nPRESCRIPTION\nDate: 18 Aug 2026\nRx'))).toBe('Dr Sharma Clinic Prescription · 18 Aug 2026')
  })

  it('recognizes Hindi document labels while preserving Hindi subject suggestions', () => {
    expect(generateDocumentTitle(document('उत्तर प्रदेश पावर कॉर्पोरेशन\nबिजली बिल\nदिनांक: 20/08/2026\nकुल राशि ₹1,100'))).toBe('Electricity Bill · ₹1,100 · 20 Aug 2026')
    expect(generateDocumentTitle(document('भारत सरकार\nकार्यालय ज्ञापन\nविषय: निदेशक की नियुक्ति\nदिनांक: 21/08/2026'))).toBe('निदेशक की नियुक्ति')
  })
})
