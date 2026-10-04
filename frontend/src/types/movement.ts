/** 出柜流水：按只数永久出柜（销毁 / 提取研究 / 转移等），从在柜库存扣减并留台账 */
export interface Movement {
  id: string
  specimenId: string
  /** 出柜时所在插位 */
  storageId: string
  /** 本次出柜只数 */
  count: number
  /** 出柜原因 */
  reason: string
  date: string
  handler: string
  note: string
}
