import { create } from 'zustand'
import type { Movement, Storage, StorageMethod } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'
import { movementStore } from './movementStore'
import { slotKey, validateSplit, type SplitError, type SplitPart } from '@/utils/stock'
import { uid } from '@/utils/id'

export interface SplitInput {
  specimenId: string
  /** 本次需要安排插位的只数（= 登记总数 − 在柜 − 借出中 − 已出柜） */
  expectedCount: number
  parts: SplitPart[]
  method: StorageMethod
  storedDate: string
  handler: string
  /**
   * 重新分装模式：先撤掉该份标本当前全部插位再按新方案落位。
   * 用于「分装错了改方案」：失败时旧插位也一并恢复，重试不会重复占位。
   */
  replace?: boolean
}

export interface SplitResult {
  ok: boolean
  error?: SplitError
  rows?: Storage[]
}

export interface TakeOutInput {
  storage: Storage
  /** 本次出柜只数（按只数算） */
  count: number
  reason: string
  date: string
  handler: string
  note?: string
}

export interface TakeOutResult {
  ok: boolean
  error?: string
}

export interface StorageState {
  rows: Storage[]
  loaded: boolean
  hydrate: () => Promise<void>
  /**
   * 原子分装：一份标本散放进多个插位。
   * 只数对不上 / 插位冲突 / 批次内重复 → 整份回滚，本次没放下的都不占位；
   * 重试时先清掉该份旧记录，同一方案不会产生重复插位。
   */
  splitPlace: (input: SplitInput) => Promise<SplitResult>
  /** 按只数出柜：从指定插位扣减，扣到 0 删除插位，并写出柜流水 */
  takeOut: (input: TakeOutInput) => Promise<TakeOutResult>
  remove: (id: string) => Promise<void>
  removeBySpecimen: (specimenId: string) => Promise<void>
}

const sortRows = (rows: Storage[]): Storage[] =>
  rows.sort((a, b) => slotKey(a).localeCompare(slotKey(b)))

export const storageStore = create<StorageState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = sortRows(await loadAll<Storage>(db.storages))
    set({ rows, loaded: true })
  },

  splitPlace: async ({ specimenId, expectedCount, parts, method, storedDate, handler, replace }) => {
    // 内存层先做校验，冲突信息可直接回显；事务内会再查一次，保证并发下也原子
    const current = await db.storages.toArray()
    const error = validateSplit(parts, expectedCount, current, replace ? specimenId : undefined)
    if (error) return { ok: false, error }

    const incomingKeys = new Set(parts.map((part) => slotKey(part)))

    try {
      const written = await db.transaction('rw', db.storages, async () => {
        const fresh = await db.storages.toArray()
        const txError = validateSplit(parts, expectedCount, fresh, replace ? specimenId : undefined)
        if (txError) throw txError

        // 重试不重复占位：
        // - replace 模式撤掉该份标本全部旧插位，按新方案整份重排；
        // - 追加模式只清理「同一次重试」里此前可能留下的该份插位。
        //   正常追加时待分装只数对应的都是空插位，这里查不到任何记录、不删除任何东西；
        //   该份已分装到其它插位的只数一律不动。
        const staleIds = replace
          ? fresh.filter((item) => item.specimenId === specimenId).map((item) => item.id)
          : fresh
              .filter((item) => item.specimenId === specimenId && incomingKeys.has(slotKey(item)))
              .map((item) => item.id)
        if (staleIds.length > 0) await db.storages.bulkDelete(staleIds)

        const rows: Storage[] = parts.map((part) => ({
          id: uid('stg'),
          specimenId,
          method,
          cabinet: part.cabinet,
          drawer: part.drawer,
          box: part.box,
          slot: part.slot,
          count: part.count,
          storedDate,
          handler: handler.trim()
        }))
        await db.storages.bulkPut(rows)
        return rows
      })
      await get().hydrate()
      return { ok: true, rows: written }
    } catch (cause) {
      // 整份回滚：事务已保证没有任何插位落库
      return { ok: false, error: cause as SplitError }
    }
  },

  takeOut: async ({ storage, count, reason, date, handler, note }) => {
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, error: '出柜只数必须是大于 0 的整数' }
    }
    if (count > storage.count) {
      return { ok: false, error: `该插位只有 ${storage.count} 只，不够出柜 ${count} 只` }
    }
    await db.transaction('rw', db.storages, db.movements, async () => {
      const fresh = await db.storages.get(storage.id)
      if (!fresh) throw new Error('插位记录已不存在，请刷新后重试')
      if (count > fresh.count) throw new Error(`该插位只有 ${fresh.count} 只，不够出柜 ${count} 只`)

      const movement: Movement = {
        id: uid('mov'),
        specimenId: fresh.specimenId,
        storageId: fresh.id,
        count,
        reason: reason.trim(),
        date,
        handler: handler.trim(),
        note: (note ?? '').trim()
      }
      await db.movements.put(movement)

      if (fresh.count === count) {
        await db.storages.delete(fresh.id)
      } else {
        await db.storages.put({ ...fresh, count: fresh.count - count })
      }
    })
    await get().hydrate()
    await movementStore.getState().hydrate()
    return { ok: true }
  },

  remove: async (id) => {
    await db.storages.delete(id)
    await get().hydrate()
  },
  removeBySpecimen: async (specimenId) => {
    await db.storages.where('specimenId').equals(specimenId).delete()
    await get().hydrate()
  }
}))
