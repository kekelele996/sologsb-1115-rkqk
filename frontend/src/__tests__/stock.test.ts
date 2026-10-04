import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db, SCHEMA_VERSION } from '@/hooks/usePersistentStore'
import { storageStore } from '@/stores/storageStore'
import { loanStore } from '@/stores/loanStore'
import { movementStore } from '@/stores/movementStore'
import { accountsOf } from '@/utils/stock'
import type { Specimen, Storage } from '@/types'

const today = () => new Date().toISOString().slice(0, 10)

const specimen = (id: string, quantity: number): Specimen => ({
  id,
  code: `${id}-2026-0001`,
  order: '双翅目',
  family: '摇蚊科',
  genus: '',
  species: '',
  tempName: '摇蚊',
  collectDate: today(),
  collector: '蓝澈',
  sex: '未知',
  stage: '幼虫',
  bodyLength: 6,
  method: '扫网',
  quantity,
  status: '待鉴定',
  determiner: '',
  siteId: 's1',
  note: ''
})

const part = (slot: number, count = 1) => ({ cabinet: 'C09', drawer: 1, box: 1, slot, count })

const accounts = async (sp: Specimen) => {
  const [storages, loans, movements] = await Promise.all([
    db.storages.toArray(),
    db.loans.toArray(),
    db.movements.toArray()
  ])
  return accountsOf(sp, storages, loans, movements)
}

describe('浸液标本插位分装', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.specimens.put(specimen('sp_a', 12))
    await db.specimens.put(specimen('sp_b', 4))
  })

  it('一份可散放进多个插位，只数按插位记，账实相等', async () => {
    const r = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 5)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(true)
    const rows = await db.storages.where('specimenId').equals('sp_a').toArray()
    expect(rows).toHaveLength(2)
    expect(rows.reduce((s, x) => s + x.count, 0)).toBe(12)
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ stored: 12, balanced: true, pending: 0 })
  })

  it('只数对不上：整份退回，不留任何插位', async () => {
    const r = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 4)], // 11 ≠ 12
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('SUM_MISMATCH')
    expect(await db.storages.count()).toBe(0)
  })

  it('插位被占用：整份退回；另一份成功不受影响', async () => {
    const okFirst = await storageStore.getState().splitPlace({
      specimenId: 'sp_b',
      expectedCount: 4,
      parts: [part(3, 4)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(okFirst.ok).toBe(true)

    const r = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 8), part(3, 4)], // S03 已被 sp_b 占
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('SLOT_OCCUPIED')
    // sp_a 一条都没落，sp_b 原样还在
    expect(await db.storages.where('specimenId').equals('sp_a').count()).toBe(0)
    const b = await db.storages.where('specimenId').equals('sp_b').toArray()
    expect(b).toHaveLength(1)
    expect(b[0].count).toBe(4)
  })

  it('批次内插位重复：整份退回', async () => {
    const r = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 6), { ...part(1), count: 6 }],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('DUP_SLOT_IN_BATCH')
    expect(await db.storages.count()).toBe(0)
  })

  it('只数非正整数：整份退回', async () => {
    const r = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 12), { ...part(2), count: 0 }],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('NON_POSITIVE_COUNT')
    expect(await db.storages.count()).toBe(0)
  })

  it('重试不重复占位：失败后用正确方案重试，只产生方案内插位', async () => {
    const bad = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 4)], // 11 ≠ 12
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(bad.ok).toBe(false)
    const good = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 5)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    expect(good.ok).toBe(true)
    expect(await db.storages.count()).toBe(2)
  })

  it('整份重排：撤掉旧插位按新方案落位；失败时旧插位原样恢复', async () => {
    await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 5)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
    // 失败的重排（只数 10 ≠ 12）：事务回滚，旧插位还在
    const bad = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 6), part(4, 4)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽',
      replace: true
    })
    expect(bad.ok).toBe(false)
    const restored = await db.storages.where('specimenId').equals('sp_a').toArray()
    expect(restored).toHaveLength(2)
    expect(restored.sort((x, y) => x.slot - y.slot).map((x) => x.count)).toEqual([7, 5])

    // 成功的重排：旧插位清空，只留新方案
    const good = await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(3, 4), part(4, 4), part(5, 4)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽',
      replace: true
    })
    expect(good.ok).toBe(true)
    const rows = await db.storages.where('specimenId').equals('sp_a').toArray()
    expect(rows.map((x) => x.slot).sort()).toEqual([3, 4, 5])
    expect(rows.reduce((s, x) => s + x.count, 0)).toBe(12)
  })
})

describe('出柜与借出按只数算', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.specimens.put(specimen('sp_a', 12))
    await storageStore.getState().splitPlace({
      specimenId: 'sp_a',
      expectedCount: 12,
      parts: [part(1, 7), part(2, 5)],
      method: '浸液',
      storedDate: today(),
      handler: '覃羽'
    })
  })

  it('出柜 3 只：插位变 4 只，写出柜流水，账实仍平', async () => {
    const slot1 = (await db.storages.toArray()).find((x) => x.slot === 1)!
    const r = await storageStore.getState().takeOut({
      storage: slot1,
      count: 3,
      reason: '提取解剖',
      date: today(),
      handler: '覃羽'
    })
    expect(r.ok).toBe(true)
    const after = (await db.storages.get(slot1.id))!
    expect(after.count).toBe(4)
    const movements = await db.movements.toArray()
    expect(movements).toHaveLength(1)
    expect(movements[0].count).toBe(3)
    await movementStore.getState().hydrate()
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ stored: 9, takenOut: 3, balanced: true })
  })

  it('出柜清空插位：插位删除', async () => {
    const slot2 = (await db.storages.toArray()).find((x) => x.slot === 2)!
    const r = await storageStore.getState().takeOut({ storage: slot2, count: 5, reason: '销毁', date: today(), handler: '覃羽' })
    expect(r.ok).toBe(true)
    expect(await db.storages.get(slot2.id)).toBeUndefined()
  })

  it('出柜超过插位只数：拒绝', async () => {
    const slot1 = (await db.storages.toArray()).find((x) => x.slot === 1)!
    const r = await storageStore.getState().takeOut({ storage: slot1, count: 8, reason: 'x', date: today(), handler: '覃羽' })
    expect(r.ok).toBe(false)
    expect((await db.storages.get(slot1.id))!.count).toBe(7)
  })

  it('借出 3 只并分批归还：库存与借出中只数随流水变化', async () => {
    const slot1 = (await db.storages.toArray()).find((x) => x.slot === 1)!
    const loan = await loanStore.getState().loanOut({
      specimenId: 'sp_a',
      storageId: slot1.id,
      count: 3,
      borrower: '贵州大学昆虫研究所',
      date: today(),
      dueDate: today(),
      handler: '覃羽'
    })
    expect(loan.ok).toBe(true)
    await storageStore.getState().hydrate()
    expect((await db.storages.get(slot1.id))!.count).toBe(4)
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ stored: 9, loaned: 3, balanced: true })

    const loanRow = (await db.loans.toArray())[0]
    // 归还 2 只到现存插位
    const repay1 = await loanStore.getState().repay({
      loanId: loanRow.id,
      count: 2,
      storageId: slot1.id,
      date: today(),
      handler: '覃羽'
    })
    expect(repay1.ok).toBe(true)
    await storageStore.getState().hydrate()
    expect((await db.storages.get(slot1.id))!.count).toBe(6)
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ stored: 11, loaned: 1, balanced: true })

    // 多还：拒绝
    const repayBad = await loanStore.getState().repay({
      loanId: loanRow.id,
      count: 2,
      storageId: slot1.id,
      date: today(),
      handler: '覃羽'
    })
    expect(repayBad.ok).toBe(false)
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ loaned: 1 })

    // 还完最后 1 只
    const repay2 = await loanStore.getState().repay({
      loanId: loanRow.id,
      count: 1,
      storageId: slot1.id,
      date: today(),
      handler: '覃羽'
    })
    expect(repay2.ok).toBe(true)
    await storageStore.getState().hydrate()
    expect(await accounts(specimen('sp_a', 12))).toMatchObject({ stored: 12, loaned: 0, balanced: true })
  })
})

describe('旧数据 v3 迁移', () => {
  it('旧插位照旧只占一个插位，只数补为登记总数', async () => {
    // 构造一个 v2 库（storages 无 count 字段、无 loans/movements 表）
    await db.close()
    await db.delete()
    const Dexie = (await import('dexie')).default
    const old = new Dexie('gbinsectlog')
    old.version(2).stores({
      specimens: 'id, code, order, family, status, siteId, collectDate',
      sites: 'id, code, name, habitat',
      storages: 'id, specimenId, cabinet, drawer',
      determinations: 'id, specimenId, determiner, date',
      meta: 'key'
    })
    await old.table('specimens').bulkPut([{ ...specimen('sp_old', 9), method: '扫网' }])
    const legacyStorage: Omit<Storage, 'count'> = {
      id: 'stg_old',
      specimenId: 'sp_old',
      method: '浸液',
      cabinet: 'C01',
      drawer: 1,
      box: 1,
      slot: 1,
      storedDate: today(),
      handler: '覃羽'
    }
    await old.table('storages').bulkPut([legacyStorage as unknown as Storage])
    old.close()

    // 重新打开当前版本，触发 v3 upgrade
    await db.open()
    expect(SCHEMA_VERSION).toBe(3)
    const migrated = await db.storages.get('stg_old')
    expect(migrated?.count).toBe(9)
    expect(await db.storages.count()).toBe(1)
    expect(await db.loans.count()).toBe(0)
    expect(await db.movements.count()).toBe(0)
  })
})
