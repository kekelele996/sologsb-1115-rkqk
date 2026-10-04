/** 借出/归还流水：出柜外借按只数算，一笔流水记录一次借出或一次归还 */
export interface Loan {
  id: string
  specimenId: string
  /** 经手插位（借出时从该插位扣减；归还时放回目标插位由 storageId 体现） */
  storageId: string
  /** 借用人/单位 */
  borrower: string
  /** 本流水只数：借出为正出库，归还为负回库 */
  count: number
  date: string
  dueDate: string
  handler: string
  note: string
  /** 借出流水的归还流水 id；归还流水上指向所归还的借出流水 id */
  returnedLoanId?: string
  /** true = 归还流水 */
  isReturn?: boolean
}
