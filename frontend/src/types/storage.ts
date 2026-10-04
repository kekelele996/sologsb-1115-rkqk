/** 保藏方式 */
export const STORAGE_METHODS = ['针插', '浸液', '玻片', '干燥'] as const
export type StorageMethod = (typeof STORAGE_METHODS)[number]

/**
 * Storage 保藏位置（插位分装记录）
 *
 * 一份标本可散放进多个插位：同一 specimenId 允许存在多条记录，
 * 每条记录只代表该份标本在这个插位上的一部分（count 只）。
 * 每个插位（柜-屉-盒-位）全局唯一，只放一份标本的一部分。
 */
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
  /** 本插位实放只数（只数按插位记，全部插位之和对应该份在柜只数） */
  count: number
  storedDate: string
  handler: string
}
