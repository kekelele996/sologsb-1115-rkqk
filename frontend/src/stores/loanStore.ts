import { create } from 'zustand'
import type { Loan } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'
import { storageStore } from './storageStore'
import { loanRemaining } from '@/utils/stock'
import { uid } from '@/utils/id'

export interface LoanOutInput {
  specimenId: string
  storageId: string
  count: number
  borrower: string
  date: string
  dueDate: string
  handler: string
  note?: string
}

export interface LoanOutResult {
  ok: boolean
  error?: string
}

export interface RepayInput {
  /** 所归还的借出流水 id */
  loanId: string
  /** 本次归还只数 */
  count: number
  /** 放回插位：优先该份现有在柜插位 */
  storageId: string
  date: string
  handler: string
  note?: string
}

export interface LoanState {
  rows: Loan[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 按只数借出：从指定插位扣减库存，扣到 0 删除插位，写借出流水 */
  loanOut: (input: LoanOutInput) => Promise<LoanOutResult>
  /** 按只数归还：回补插位库存，写归还流水（部分归还按未还只数校验） */
  repay: (input: RepayInput) => Promise<LoanOutResult>
}

export const loanStore = create<LoanState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Loan>(db.loans)
    rows.sort((a, b) => b.date.localeCompare(a.date))
    set({ rows, loaded: true })
  },

  loanOut: async ({ specimenId, storageId, count, borrower, date, dueDate, handler, note }) => {
    if (!borrower.trim()) return { ok: false, error: '请填写借用人 / 单位' }
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, error: '借出只数必须是大于 0 的整数' }
    }
    try {
      await db.transaction('rw', db.storages, db.loans, async () => {
        const slot = await db.storages.get(storageId)
        if (!slot || slot.specimenId !== specimenId) throw new Error('插位已变动，请重新选择')
        if (count > slot.count) throw new Error(`该插位只有 ${slot.count} 只，不够借出 ${count} 只`)

        const row: Loan = {
          id: uid('ln'),
          specimenId,
          storageId,
          borrower: borrower.trim(),
          count,
          date,
          dueDate,
          handler: handler.trim(),
          note: (note ?? '').trim()
        }
        await db.loans.put(row)
        if (slot.count === count) {
          await db.storages.delete(slot.id)
        } else {
          await db.storages.put({ ...slot, count: slot.count - count })
        }
      })
      await get().hydrate()
      await storageStore.getState().hydrate()
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : '借出失败，已回滚' }
    }
  },

  repay: async ({ loanId, count, storageId, date, handler, note }) => {
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, error: '归还只数必须是大于 0 的整数' }
    }
    try {
      await db.transaction('rw', db.storages, db.loans, async () => {
        const loan = await db.loans.get(loanId)
        if (!loan || loan.isReturn) throw new Error('借出记录不存在或已结清')
        const all = await db.loans.toArray()
        const remaining = loanRemaining(all, loan)
        if (count > remaining) throw new Error(`该笔借出未还 ${remaining} 只，不能归还 ${count} 只`)

        const slot = await db.storages.get(storageId)
        if (!slot || slot.specimenId !== loan.specimenId) {
          throw new Error('请选择该份标本当前在柜的插位放回；无在柜插位时请先到柜位图分装')
        }
        await db.storages.put({ ...slot, count: slot.count + count })
        const row: Loan = {
          id: uid('rt'),
          specimenId: loan.specimenId,
          storageId,
          borrower: loan.borrower,
          count,
          date,
          dueDate: '',
          handler: handler.trim(),
          note: (note ?? '').trim(),
          isReturn: true,
          returnedLoanId: loan.id
        }
        await db.loans.put(row)
      })
      await get().hydrate()
      await storageStore.getState().hydrate()
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : '归还失败，已回滚' }
    }
  }
}))
