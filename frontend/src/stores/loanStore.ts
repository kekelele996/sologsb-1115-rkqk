import { create } from 'zustand'
import type { Loan } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'

export interface LoanState {
  rows: Loan[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 借出：按只数登记 */
  loan: (specimenId: string, count: number, borrower: string) => Promise<void>
  /** 归还：标记归还日期 */
  giveBack: (id: string) => Promise<void>
  removeBySpecimen: (specimenId: string) => Promise<void>
}

export const loanStore = create<LoanState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Loan>(db.loans)
    rows.sort((a, b) => a.loanDate.localeCompare(b.loanDate))
    set({ rows, loaded: true })
  },
  loan: async (specimenId, rawCount, borrower) => {
    const count = Math.max(1, Math.floor(Number(rawCount) || 0))
    const row: Loan = {
      id: uid('loan'),
      specimenId: specimenId,
      count,
      borrower: borrower.trim() || '未记名',
      loanDate: new Date().toISOString().slice(0, 10),
      returnedDate: ''
    }
    await putRow<Loan>(db.loans, row)
    await get().hydrate()
  },
  giveBack: async (id) => {
    const target = get().rows.find((row) => row.id === id)
    if (!target || target.returnedDate) return
    await putRow<Loan>(db.loans, { ...target, returnedDate: new Date().toISOString().slice(0, 10) })
    await get().hydrate()
  },
  removeBySpecimen: async (specimenId) => {
    const targets = get().rows.filter((row) => row.specimenId === specimenId)
    await Promise.all(targets.map((row) => deleteRow<Loan>(db.loans, row.id)))
    await get().hydrate()
  }
}))
