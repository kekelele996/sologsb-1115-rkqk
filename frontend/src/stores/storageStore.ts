import { create } from 'zustand'
import type { Specimen, Storage, StorageMethod } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { findSlotRow, placedCountOf, slotOccupant } from '@/utils/codec'
import { uid } from '@/utils/id'

export interface SlotPosition {
  cabinet: string
  drawer: number
  box: number
  slot: number
}

export interface PlaceResult {
  /** 实际入柜只数 */
  placed: number
  /** 没放下、被退回的只数 */
  rejected: number
  /** 插位是否被别的标本占用（冲突时整份退回，不影响其他标本） */
  conflict: boolean
}

export interface StorageState {
  rows: Storage[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 分装：一份标本可散放多个插位，按插位记只数；超出个体总数的部分退回 */
  place: (specimen: Specimen, position: SlotPosition, count: number, method: StorageMethod, handler: string) => Promise<PlaceResult>
  /** 出柜：按只数出柜，该插位只数减到 0 时删除插位记录，返回剩余只数 */
  takeOut: (storage: Storage, count: number) => Promise<number>
  remove: (id: string) => Promise<void>
  removeBySpecimen: (specimenId: string) => Promise<void>
}

export const storageStore = create<StorageState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Storage>(db.storages)
    rows.sort((a, b) => (a.cabinet + a.drawer + a.box + a.slot).localeCompare(`${b.cabinet}${b.drawer}${b.box}${b.slot}`))
    set({ rows, loaded: true })
  },
  place: async (specimen, position, rawCount, method, handler) => {
    const want = Math.max(0, Math.floor(Number(rawCount) || 0))
    if (want <= 0) return { placed: 0, rejected: 0, conflict: false }

    const rows = get().rows
    // 插位被别的标本占用 → 冲突，整份退回（只退这一份，不影响其他标本）
    const occupant = slotOccupant(rows, position)
    if (occupant && occupant.specimenId !== specimen.id) {
      return { placed: 0, rejected: want, conflict: true }
    }

    // 同一标本同一插位：更新已有记录，重试不重复占位
    const existing = findSlotRow(rows, specimen.id, position)
    const placedSoFar = placedCountOf(rows, specimen.id)
    // 采集登记管个体总数：各插位只数之和不得超过该总数
    const room = specimen.quantity - placedSoFar
    const placed = Math.min(want, room)
    const rejected = want - placed

    if (placed > 0) {
      const storedDate = new Date().toISOString().slice(0, 10)
      const row: Storage = existing
        ? { ...existing, count: existing.count + placed }
        : {
            id: uid('stg'),
            specimenId: specimen.id,
            method,
            cabinet: position.cabinet,
            drawer: position.drawer,
            box: position.box,
            slot: position.slot,
            count: placed,
            storedDate,
            handler
          }
      await putRow<Storage>(db.storages, row)
      await get().hydrate()
    }
    return { placed, rejected, conflict: false }
  },
  takeOut: async (storage, rawCount) => {
    const want = Math.max(0, Math.floor(Number(rawCount) || 0))
    if (want <= 0) return storage.count
    const remaining = storage.count - want
    if (remaining <= 0) {
      await deleteRow<Storage>(db.storages, storage.id)
      await get().hydrate()
      return 0
    }
    await putRow<Storage>(db.storages, { ...storage, count: remaining })
    await get().hydrate()
    return remaining
  },
  remove: async (id) => {
    await deleteRow<Storage>(db.storages, id)
    await get().hydrate()
  },
  removeBySpecimen: async (specimenId) => {
    const targets = get().rows.filter((row) => row.specimenId === specimenId)
    await Promise.all(targets.map((row) => deleteRow<Storage>(db.storages, row.id)))
    await get().hydrate()
  }
}))
