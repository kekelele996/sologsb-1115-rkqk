import { useStore } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import Dexie, { type Table } from 'dexie'
import type { CollectSite, Determination, Loan, Movement, Specimen, Storage } from '@/types'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：标本 / 采集地 / 保藏位置 / 鉴定记录 / 借出 / 出柜 六张业务表 + 元数据表 */
class InsectLogDb extends Dexie {
  specimens!: Table<Specimen, string>
  sites!: Table<CollectSite, string>
  storages!: Table<Storage, string>
  determinations!: Table<Determination, string>
  loans!: Table<Loan, string>
  movements!: Table<Movement, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbinsectlog')
    this.version(1).stores({
      specimens: 'id, code, order, status, siteId',
      sites: 'id, code, name',
      storages: 'id, specimenId, cabinet',
      determinations: 'id, specimenId, determiner',
      meta: 'key'
    })
    // v2：新增「采集方式」字段，迁移时为历史标本补齐默认采集方式（扫网）
    this.version(2).stores({
      specimens: 'id, code, order, family, status, siteId, collectDate',
      sites: 'id, code, name, habitat',
      storages: 'id, specimenId, cabinet, drawer',
      determinations: 'id, specimenId, determiner, date',
      meta: 'key'
    })
    // v3：一份标本散放多个插位，只数按插位记（storages.count）；
    // 新增借出流水 loans 与出柜流水 movements；旧插位照旧只占一个插位，只数补为该份总数
    this.version(SCHEMA_VERSION)
      .stores({
        specimens: 'id, code, order, family, status, siteId, collectDate',
        sites: 'id, code, name, habitat',
        storages: 'id, specimenId, cabinet, drawer',
        determinations: 'id, specimenId, determiner, date',
        loans: 'id, specimenId, storageId, borrower, date',
        movements: 'id, specimenId, storageId, date',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        const quantityOf = new Map<string, number>()
        await tx
          .table<Specimen, string>('specimens')
          .each((specimen) => quantityOf.set(specimen.id, specimen.quantity))
        await tx
          .table<Storage, string>('storages')
          .toCollection()
          .modify((storage) => {
            if (!Number.isFinite(storage.count) || storage.count < 1) {
              // 旧数据：一份只占一个插位，该插位只数 = 登记总数
              storage.count = quantityOf.get(storage.specimenId) ?? 1
            }
          })
        // 补齐 v1→v2 时遗漏的默认采集方式（历史库兼容）
        await tx
          .table<Specimen, string>('specimens')
          .toCollection()
          .modify((specimen) => {
            if (!specimen.method) {
              specimen.method = '扫网'
            }
          })
      })
  }
}

export const db = new InsectLogDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function loadAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function putRow<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 批量写入 */
export async function putRows<T extends object>(table: Table<T, string>, rows: T[]): Promise<void> {
  await table.bulkPut(rows)
}

/** 删除一条记录 */
export async function deleteRow<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/**
 * 把 Zustand store 桥接到 React：
 * - 所有页面通过它读取 store（内部即 Dexie 表的内存镜像）
 * - 写入统一走 store 的 save / remove，由 store 调用 Dexie 并回填内存状态
 */
export function usePersistentStore<T extends object>(store: UseBoundStore<StoreApi<T>>): T
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector: (state: T) => S
): S
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector?: (state: T) => S
): T | S {
  return useStore(store, selector ?? ((state: T) => state as unknown as S))
}

/** 首次打开时写入示例数据，保证各页面进入即有事可做 */
export async function seedDemoData(): Promise<void> {
  const count = await db.sites.count()
  if (count > 0) return

  const today = new Date().toISOString().slice(0, 10)
  const due = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)

  await db.sites.bulkPut([
    {
      id: 'site_qlb',
      code: 'QLB',
      name: '青龙背斜阔叶林样地',
      region: '黔南州 · 平塘县',
      longitude: 107.2136,
      latitude: 25.8123,
      altitude: 986,
      habitat: '阔叶林',
      microHabitat: '林下腐殖层厚，倒木与落叶堆积',
      microClimate: '午后无风，湿度偏高',
      dateStart: today,
      dateEnd: today
    },
    {
      id: 'site_shr',
      code: 'SHR',
      name: '双河湿地芦苇荡',
      region: '黔南州 · 惠水县',
      longitude: 106.7521,
      latitude: 26.1178,
      altitude: 812,
      habitat: '湿地',
      microHabitat: '水边芦苇与香蒲混生，浅水区',
      microClimate: '傍晚起雾，风速 1 级',
      dateStart: today,
      dateEnd: today
    }
  ])

  await db.specimens.bulkPut([
    {
      id: 'sp_001',
      code: 'QLB-2026-0001',
      order: '鞘翅目',
      family: '步甲科',
      genus: 'Carabus',
      species: 'sp.',
      tempName: '大黑步甲',
      collectDate: today,
      collector: '陆昀',
      sex: '雄',
      stage: '成虫',
      bodyLength: 28.4,
      method: '徒手',
      quantity: 1,
      status: '已鉴定',
      determiner: '覃羽',
      siteId: 'site_qlb',
      note: '倒木下采集，鞘翅完整'
    },
    {
      id: 'sp_002',
      code: 'QLB-2026-0002',
      order: '鳞翅目',
      family: '夜蛾科',
      genus: '',
      species: '',
      tempName: '灰褐夜蛾',
      collectDate: today,
      collector: '陆昀',
      sex: '未知',
      stage: '成虫',
      bodyLength: 16.2,
      method: '灯诱',
      quantity: 3,
      status: '初鉴',
      determiner: '覃羽',
      siteId: 'site_qlb',
      note: '灯诱 20:30–22:00，翅面有磨损'
    },
    {
      id: 'sp_003',
      code: 'SHR-2026-0001',
      order: '蜻蜓目',
      family: '蜻科',
      genus: 'Sympetrum',
      species: '',
      tempName: '赤蜻（待复核）',
      collectDate: today,
      collector: '蓝澈',
      sex: '雌',
      stage: '成虫',
      bodyLength: 38.1,
      method: '扫网',
      quantity: 2,
      status: '待复核',
      determiner: '蓝澈',
      siteId: 'site_shr',
      note: '与相近种混淆，需核对翅脉'
    },
    {
      id: 'sp_004',
      code: 'SHR-2026-0002',
      order: '双翅目',
      family: '摇蚊科',
      genus: '',
      species: '',
      tempName: '摇蚊未定种',
      collectDate: today,
      collector: '蓝澈',
      sex: '未知',
      stage: '幼虫',
      bodyLength: 6.5,
      method: '巴氏罐诱',
      quantity: 12,
      status: '待鉴定',
      determiner: '',
      siteId: 'site_shr',
      note: '酒精浸液保存，一瓶多只，分装两个插位'
    },
    {
      id: 'sp_005',
      code: 'SHR-2026-0003',
      order: '半翅目',
      family: '划蝽科',
      genus: '',
      species: '',
      tempName: '划蝽待定',
      collectDate: today,
      collector: '蓝澈',
      sex: '未知',
      stage: '成虫',
      bodyLength: 8.2,
      method: '徒手',
      quantity: 8,
      status: '初鉴',
      determiner: '',
      siteId: 'site_shr',
      note: '浸液标本 8 只，分装两插位，其中 3 只外借贵州大学昆虫研究所'
    }
  ])

  await db.determinations.bulkPut([
    {
      id: 'det_001',
      specimenId: 'sp_001',
      determiner: '覃羽',
      date: today,
      conclusion: 'Carabus smaragdinus',
      reference: '《中国步甲志》第二卷 P.218',
      confidence: '高',
      needReview: false
    },
    {
      id: 'det_002',
      specimenId: 'sp_002',
      determiner: '覃羽',
      date: today,
      conclusion: 'Noctuidae sp.',
      reference: '《中国蛾类图鉴》Vol.3',
      confidence: '中',
      needReview: true
    }
  ])

  await db.storages.bulkPut([
    // 旧规分装：一份一个插位，只数 = 登记总数
    {
      id: 'stg_001',
      specimenId: 'sp_001',
      method: '针插',
      cabinet: 'C01',
      drawer: 1,
      box: 2,
      slot: 3,
      count: 1,
      storedDate: today,
      handler: '覃羽'
    },
    {
      id: 'stg_002',
      specimenId: 'sp_002',
      method: '针插',
      cabinet: 'C01',
      drawer: 1,
      box: 2,
      slot: 5,
      count: 3,
      storedDate: today,
      handler: '覃羽'
    },
    // 浸液一份散放两个插位：7 + 5 = 12 只
    {
      id: 'stg_003',
      specimenId: 'sp_004',
      method: '浸液',
      cabinet: 'C02',
      drawer: 1,
      box: 1,
      slot: 1,
      count: 7,
      storedDate: today,
      handler: '覃羽'
    },
    {
      id: 'stg_004',
      specimenId: 'sp_004',
      method: '浸液',
      cabinet: 'C02',
      drawer: 1,
      box: 1,
      slot: 2,
      count: 5,
      storedDate: today,
      handler: '覃羽'
    },
    // 划蝽 8 只分装 3 + 2（另 3 只外借中）
    {
      id: 'stg_005',
      specimenId: 'sp_005',
      method: '浸液',
      cabinet: 'C02',
      drawer: 1,
      box: 2,
      slot: 1,
      count: 3,
      storedDate: today,
      handler: '覃羽'
    },
    {
      id: 'stg_006',
      specimenId: 'sp_005',
      method: '浸液',
      cabinet: 'C02',
      drawer: 1,
      box: 2,
      slot: 2,
      count: 2,
      storedDate: today,
      handler: '覃羽'
    }
  ])

  await db.loans.bulkPut([
    {
      id: 'ln_001',
      specimenId: 'sp_005',
      storageId: 'stg_005',
      borrower: '贵州大学昆虫研究所',
      count: 3,
      date: today,
      dueDate: due,
      handler: '覃羽',
      note: '合作研究，限解剖 1 只'
    }
  ])
}
