/** Loan 借出记录：标本借出按只数登记 */
export interface Loan {
  id: string
  specimenId: string
  /** 借出只数 */
  count: number
  borrower: string
  /** 借出日期 */
  loanDate: string
  /** 归还日期（未归还为空） */
  returnedDate: string
}
