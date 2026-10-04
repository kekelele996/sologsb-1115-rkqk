import { create } from 'zustand'
import type { Movement } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'

export interface MovementState {
  rows: Movement[]
  loaded: boolean
  hydrate: () => Promise<void>
}

/** 出柜流水：按只数永久出柜的台账，由 storageStore.takeOut 写入，这里只做镜像读取 */
export const movementStore = create<MovementState>((set) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Movement>(db.movements)
    rows.sort((a, b) => b.date.localeCompare(a.date))
    set({ rows, loaded: true })
  }
}))
