/** 保藏方式 */
export const STORAGE_METHODS = ['针插', '浸液', '玻片', '干燥'] as const
export type StorageMethod = (typeof STORAGE_METHODS)[number]

/** Storage 保藏位置（插位分装：一份标本可散放多个插位，每个插位只放它一部分） */
export interface Storage {
  id: string
  specimenId: string
  method: StorageMethod
  /** 标本柜编号 */
  cabinet: string
  /** 抽屉号 */
  drawer: number
  /** 标本盒号 */
  box: number
  /** 插位序号 */
  slot: number
  /** 该插位存放的个体数量（只数），一份标本各插位只数之和不超过其个体总数 */
  count: number
  storedDate: string
  handler: string
}
