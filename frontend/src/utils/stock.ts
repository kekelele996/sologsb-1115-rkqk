import type { Loan, Movement, Specimen, Storage } from '@/types'
import { encodeSlot } from './codec'

/** 柜位唯一键：C03-D2-B05-S12 */
export function slotKey(storage: Pick<Storage, 'cabinet' | 'drawer' | 'box' | 'slot'>): string {
  return encodeSlot(storage.cabinet, storage.drawer, storage.box, storage.slot)
}

/** 该份标本当前在柜只数（所有插位只数之和） */
export function storedCount(storages: Storage[], specimenId: string): number {
  return storages
    .filter((item) => item.specimenId === specimenId)
    .reduce((sum, item) => sum + item.count, 0)
}

/** 该份标本当前借出中只数（借出未归还部分） */
export function loanedOutCount(loans: Loan[], specimenId: string): number {
  return loans
    .filter((item) => item.specimenId === specimenId && !item.isReturn)
    .reduce((sum, item) => {
      const returned = loans
        .filter((row) => row.isReturn && row.returnedLoanId === item.id)
        .reduce((sub, row) => sub + row.count, 0)
      return sum + Math.max(0, item.count - returned)
    }, 0)
}

/** 某笔借出流水尚未归还只数 */
export function loanRemaining(loans: Loan[], loan: Loan): number {
  if (loan.isReturn) return 0
  const returned = loans
    .filter((row) => row.isReturn && row.returnedLoanId === loan.id)
    .reduce((sum, row) => sum + row.count, 0)
  return Math.max(0, loan.count - returned)
}

/** 该份标本累计出柜只数 */
export function takenOutCount(movements: Movement[], specimenId: string): number {
  return movements
    .filter((item) => item.specimenId === specimenId)
    .reduce((sum, item) => sum + item.count, 0)
}

/** 账实核对：登记总数 = 在柜 + 借出中 + 已出柜 */
export function accountsOf(
  specimen: Specimen,
  storages: Storage[],
  loans: Loan[],
  movements: Movement[]
): { total: number; stored: number; loaned: number; takenOut: number; balanced: boolean; pending: number } {
  const stored = storedCount(storages, specimen.id)
  const loaned = loanedOutCount(loans, specimen.id)
  const takenOut = takenOutCount(movements, specimen.id)
  const balanced = stored + loaned + takenOut === specimen.quantity
  // 还需库房安排插位的只数（采集登记总数 − 已有去向）
  const pending = specimen.quantity - stored - loaned - takenOut
  return { total: specimen.quantity, stored, loaned, takenOut, balanced, pending }
}

export interface SplitPart {
  cabinet: string
  drawer: number
  box: number
  slot: number
  count: number
}

export type SplitErrorCode =
  | 'EMPTY'
  | 'NON_POSITIVE_COUNT'
  | 'SUM_MISMATCH'
  | 'DUP_SLOT_IN_BATCH'
  | 'SLOT_OCCUPIED'
  | 'NO_PENDING'

export interface SplitError {
  code: SplitErrorCode
  message: string
  /** 冲突的插位键（SLOTS_OCCUPIED 时给出） */
  slot?: string
}

/**
 * 校验一次分装方案（只按插位记）：
 * - 每个插位只数必须为正整数；
 * - 本次分装只数之和必须正好等于待入柜只数（两边对不上就整份退回，不入任何插位）；
 * - 批次内不能重复插位；
 * - 目标插位不能被其它标本占用。
 */
export function validateSplit(
  parts: SplitPart[],
  expectedCount: number,
  existing: Storage[],
  /** 被重新分装的标本 id：其自身当前占用的插位允许覆盖 */
  specimenId?: string
): SplitError | null {
  if (expectedCount <= 0) {
    return { code: 'NO_PENDING', message: '这份标本的登记只数都已安排去向，没有待分装只数' }
  }
  if (parts.length === 0) {
    return { code: 'EMPTY', message: '本次分装没有任何插位，全部退回' }
  }
  if (parts.some((part) => !Number.isInteger(part.count) || part.count <= 0)) {
    return { code: 'NON_POSITIVE_COUNT', message: '每个插位的只数必须是大于 0 的整数' }
  }
  const sum = parts.reduce((total, part) => total + part.count, 0)
  if (sum !== expectedCount) {
    return {
      code: 'SUM_MISMATCH',
      message: `只数对不上：本次分装 ${sum} 只，应放 ${expectedCount} 只，本次没放下的全部退回`
    }
  }
  const seen = new Set<string>()
  for (const part of parts) {
    const key = slotKey(part)
    if (seen.has(key)) {
      return { code: 'DUP_SLOT_IN_BATCH', message: `分装方案里插位 ${key} 重复了`, slot: key }
    }
    seen.add(key)
  }
  for (const part of parts) {
    const key = slotKey(part)
    const occupant = existing.find(
      (item) => slotKey(item) === key && !(specimenId && item.specimenId === specimenId)
    )
    if (occupant) {
      return { code: 'SLOT_OCCUPIED', message: `插位 ${key} 已被其它标本占用，本次分装退回`, slot: key }
    }
  }
  return null
}
