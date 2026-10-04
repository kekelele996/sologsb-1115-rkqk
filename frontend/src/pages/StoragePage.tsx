import { useMemo, useState } from 'react'
import type { Storage, StorageMethod } from '@/types'
import { STORAGE_METHODS } from '@/types'
import CabinetGrid from '@/components/common/CabinetGrid'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { storageStore } from '@/stores/storageStore'
import { loanStore } from '@/stores/loanStore'
import { movementStore } from '@/stores/movementStore'
import { encodeSlot, specimenTaxon, storageSlotText } from '@/utils/codec'
import { accountsOf, slotKey } from '@/utils/stock'

interface PartDraft {
  id: string
  cabinet: string
  drawer: number
  box: number
  slot: number
  count: string
}

const newPart = (cabinet: string, drawer = 1, box = 1, slot = 1): PartDraft => ({
  id: `part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  cabinet,
  drawer,
  box,
  slot,
  count: ''
})

/** 保藏柜位图：一份标本可散放进多个插位，只数按插位记；对不上整份退回，重试不重复占位 */
export default function StoragePage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)
  const loans = usePersistentStore(loanStore, (state) => state.rows)
  const movements = usePersistentStore(movementStore, (state) => state.rows)

  const [cabinet, setCabinet] = useState('C02')
  const [drawers, setDrawers] = useState(2)
  const [boxes, setBoxes] = useState(3)
  const [slots, setSlots] = useState(8)
  const [method, setMethod] = useState<StorageMethod>('浸液')
  const [handler, setHandler] = useState('')

  const [specimenId, setSpecimenId] = useState('')
  const [replaceAll, setReplaceAll] = useState(false)
  const [parts, setParts] = useState<PartDraft[]>([])
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [detail, setDetail] = useState<Storage | null>(null)

  // 出柜 / 借出 行内小表单
  const [opCount, setOpCount] = useState('1')
  const [takeReason, setTakeReason] = useState('')
  const [borrower, setBorrower] = useState('')
  const [opError, setOpError] = useState('')

  const specimenMap = useMemo(() => new Map(specimens.map((item) => [item.id, item])), [specimens])
  const codeOf = (id: string): string => specimenMap.get(id)?.code ?? '未知'

  const accounts = useMemo(() => {
    const map = new Map(specimens.map((item) => [item.id, accountsOf(item, storages, loans, movements)]))
    return map
  }, [specimens, storages, loans, movements])

  // 还有只数没安排去向（待分装 / 分装后又出柜产生空缺）的标本
  const pendingSpecimens = specimens.filter((item) => (accounts.get(item.id)?.pending ?? 0) > 0)

  const selected = specimenMap.get(specimenId)
  const selectedAccounts = specimenId ? accounts.get(specimenId) : undefined
  // 本次方案应放只数：整份重排 = 在柜 + 待安排；追加 = 只放待安排
  const expectedCount = selectedAccounts
    ? replaceAll
      ? selectedAccounts.stored + selectedAccounts.pending
      : selectedAccounts.pending
    : 0
  const partsSum = parts.reduce((sum, part) => sum + (Number(part.count) || 0), 0)

  const startSplit = (id: string, replace = false): void => {
    const target = specimenMap.get(id)
    if (!target) return
    setSpecimenId(id)
    setReplaceAll(replace)
    setWarning('')
    setMessage('')
    if (replace) {
      // 预填该份当前插位，只数可逐位调整后整份重排
      const occupied = storages
        .filter((item) => item.specimenId === id)
        .sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
      setParts(
        occupied.map((item, index) => ({
          id: `part_existing_${index}_${Math.random().toString(36).slice(2, 6)}`,
          cabinet: item.cabinet,
          drawer: item.drawer,
          box: item.box,
          slot: item.slot,
          count: String(item.count)
        }))
      )
    } else {
      setParts([newPart(cabinet)])
    }
  }

  const patchPart = (id: string, patch: Partial<PartDraft>): void => {
    setParts((prev) => prev.map((part) => (part.id === id ? { ...part, ...patch } : part)))
  }

  const onGridSlot = (position: { cabinet: string; drawer: number; box: number; slot: number }): void => {
    if (!specimenId) {
      setWarning('请先在右侧选择一份有待分装只数的标本')
      return
    }
    if (replaceAll) {
      // 整份重排时点击插位：有则更新该行，无则追加一行
      const key = encodeSlot(position.cabinet, position.drawer, position.box, position.slot)
      const existing = parts.find(
        (part) => encodeSlot(part.cabinet, part.drawer, part.box, part.slot) === key
      )
      if (existing) {
        patchPart(existing.id, { count: existing.count || '1' })
      } else {
        setParts((prev) => [...prev, { ...newPart(position.cabinet), ...position, count: '' }])
      }
    } else {
      setParts((prev) => [...prev, { ...newPart(position.cabinet), ...position, count: '' }])
    }
    setWarning('')
  }

  const submitSplit = async (): Promise<void> => {
    if (!selected || !selectedAccounts) {
      setWarning('请先选择标本')
      return
    }
    const parsed = parts.map((part) => ({
      cabinet: part.cabinet.trim().toUpperCase(),
      drawer: part.drawer,
      box: part.box,
      slot: part.slot,
      count: Number(part.count)
    }))
    const result = await storageStore.getState().splitPlace({
      specimenId: selected.id,
      expectedCount,
      parts: parsed,
      method,
      storedDate: new Date().toISOString().slice(0, 10),
      handler,
      replace: replaceAll
    })
    if (!result.ok) {
      setWarning(result.error?.message ?? '分装失败，本次方案已整份退回')
      return
    }
    setMessage(
      `${selected.code} 已分装到 ${result.rows?.length ?? 0} 个插位，共 ${parsed.reduce(
        (sum, part) => sum + part.count,
        0
      )} 只`
    )
    setWarning('')
    setParts([])
    setSpecimenId('')
    setReplaceAll(false)
  }

  const runTakeOut = async (): Promise<void> => {
    if (!detail) return
    if (!takeReason.trim()) {
      setOpError('请填出柜原因（出柜按只数留台账）')
      return
    }
    const result = await storageStore.getState().takeOut({
      storage: detail,
      count: Number(opCount),
      reason: takeReason,
      date: new Date().toISOString().slice(0, 10),
      handler
    })
    if (!result.ok) {
      setOpError(result.error ?? '出柜失败')
      return
    }
    setMessage(`${codeOf(detail.specimenId)} 已从 ${storageSlotText(detail)} 出柜 ${opCount} 只`)
    setOpError('')
    setTakeReason('')
    const left = detail.count - Number(opCount)
    setOpCount('1')
    setDetail(left > 0 ? { ...detail, count: left } : null)
  }

  const runLoan = async (): Promise<void> => {
    if (!detail) return
    const result = await loanStore.getState().loanOut({
      specimenId: detail.specimenId,
      storageId: detail.id,
      count: Number(opCount),
      borrower,
      date: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      handler
    })
    if (!result.ok) {
      setOpError(result.error ?? '借出失败')
      return
    }
    setMessage(`${codeOf(detail.specimenId)} 已从 ${storageSlotText(detail)} 借出 ${opCount} 只（${borrower}）`)
    setOpError('')
    setBorrower('')
    setOpCount('1')
    setDetail(null)
  }

  const storedIndividuals = storages.reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">保藏分装柜位图</h1>
        <p className="page-sub">
          个体总数由采集登记管（{`标本.数量`}），库房只管插位分装：一份可散放进多个插位，每插位记只数；
          只数对不上整份退回，重试不重复占位。出柜与借出均按只数算。
        </p>
      </header>

      <section className="panel flex flex-wrap items-end gap-3">
        <div>
          <span className="field-label">标本柜编号</span>
          <input className="field-input w-28" value={cabinet} onChange={(e) => setCabinet(e.target.value.toUpperCase())} />
        </div>
        <div>
          <span className="field-label">抽屉数</span>
          <input type="number" min={1} max={8} className="field-input w-20" value={drawers} onChange={(e) => setDrawers(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div>
          <span className="field-label">每屉盒数</span>
          <input type="number" min={1} max={8} className="field-input w-20" value={boxes} onChange={(e) => setBoxes(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div>
          <span className="field-label">每盒插位</span>
          <input type="number" min={1} max={20} className="field-input w-20" value={slots} onChange={(e) => setSlots(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div>
          <span className="field-label">默认保藏方式</span>
          <select className="field-input w-28" value={method} onChange={(e) => setMethod(e.target.value as StorageMethod)}>
            {STORAGE_METHODS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-label">经手人</span>
          <input className="field-input w-32" value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="如 覃羽" />
        </div>
        <div className="text-xs text-slate-500">
          占用 {storages.length} 个插位 · 在柜 {storedIndividuals} 只 · 待分装标本 {pendingSpecimens.length} 份
        </div>
      </section>

      {warning ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p> : null}
      {message ? <p className="rounded-lg border border-field-100 bg-field-50 px-3 py-2 text-sm text-field-700">{message}</p> : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <CabinetGrid
          cabinet={cabinet}
          drawers={drawers}
          boxes={boxes}
          slots={slots}
          storages={storages}
          codeOf={codeOf}
          draggingCode={selected ? selected.code : null}
          onDropSlot={onGridSlot}
          onPickStorage={(storage) => {
            setDetail(storage)
            setOpError('')
            setOpCount('1')
          }}
        />

        <div className="flex flex-col gap-4">
          {/* 分装方案表单 */}
          <div className="panel">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">插位分装方案</h2>
              {specimenId ? (
                <button className="text-xs text-slate-400 hover:text-rose-600" type="button" onClick={() => setSpecimenId('')}>
                  取消选择
                </button>
              ) : null}
            </div>
            {selected && selectedAccounts ? (
              <div className="mt-2 space-y-2 text-xs text-slate-600">
                <p>
                  <span className="font-mono text-field-700">{selected.code}</span> · {specimenTaxon(selected)} ·{' '}
                  <StatusTag status={selected.status} />
                </p>
                <p className="rounded-lg bg-slate-50 px-2 py-1">
                  登记 <b>{selectedAccounts.total}</b> 只 ＝ 在柜 {selectedAccounts.stored} ＋ 借出中{' '}
                  {selectedAccounts.loaned} ＋ 已出柜 {selectedAccounts.takenOut}
                  {!selectedAccounts.balanced ? <span className="ml-1 text-amber-600">（账实不平，请核对）</span> : null}
                </p>
                {selectedAccounts.stored > 0 ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={replaceAll}
                      onChange={(e) => startSplit(selected.id, e.target.checked)}
                      className="h-3.5 w-3.5 accent-field-600"
                    />
                    整份重排（撤掉现有 {selectedAccounts.stored} 只的插位后重新落位；失败原样恢复）
                  </label>
                ) : null}
                <div className="flex items-center justify-between rounded-lg border border-field-200 bg-field-50 px-2 py-1 text-field-800">
                  <span>本次方案应放</span>
                  <b data-testid="expected-count">{expectedCount} 只</b>
                </div>

                <div className="space-y-1.5" data-testid="split-parts">
                  {parts.map((part, index) => (
                    <div key={part.id} className="flex items-center gap-1">
                      <span className="w-5 text-slate-400">{index + 1}.</span>
                      <input
                        className="field-input w-14"
                        value={part.cabinet}
                        onChange={(e) => patchPart(part.id, { cabinet: e.target.value.toUpperCase() })}
                        aria-label="柜"
                      />
                      <input
                        type="number"
                        min={1}
                        className="field-input w-14"
                        value={part.drawer}
                        onChange={(e) => patchPart(part.id, { drawer: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="抽屉"
                      />
                      <input
                        type="number"
                        min={1}
                        className="field-input w-12"
                        value={part.box}
                        onChange={(e) => patchPart(part.id, { box: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="盒"
                      />
                      <input
                        type="number"
                        min={1}
                        className="field-input w-12"
                        value={part.slot}
                        onChange={(e) => patchPart(part.id, { slot: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="插位"
                      />
                      <input
                        type="number"
                        min={1}
                        className="field-input w-16"
                        value={part.count}
                        onChange={(e) => patchPart(part.id, { count: e.target.value })}
                        placeholder="只数"
                        aria-label="只数"
                      />
                      <button
                        className="text-xs text-rose-500 hover:underline"
                        type="button"
                        onClick={() => setParts((prev) => prev.filter((row) => row.id !== part.id))}
                      >
                        删
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost" type="button" onClick={() => setParts((prev) => [...prev, newPart(cabinet)])}>
                    + 增加插位
                  </button>
                  <button className="btn-primary" type="button" onClick={() => void submitSplit()} data-testid="submit-split">
                    提交分装
                  </button>
                  <span className={`self-center text-xs ${partsSum === expectedCount ? 'text-field-700' : 'text-amber-600'}`}>
                    已填 {partsSum} / 应放 {expectedCount}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  也可直接点击左侧柜位网格的空插位追加一行。只数之和不等于应放只数、插位重复或被占用时，整份退回，不留任何插位。
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">从右下方「待分装标本」点「分装」开始；点击已入柜标本可整份重排。</p>
            )}
          </div>

          {/* 待分装 */}
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">待分装标本（按登记只数）</h2>
            <div className="mt-2 max-h-56 space-y-2 overflow-auto">
              {pendingSpecimens.map((specimen) => {
                const acc = accounts.get(specimen.id)!
                return (
                  <div key={specimen.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                    <p className="font-mono text-field-700">{specimen.code}</p>
                    <p className="text-slate-600">{specimenTaxon(specimen)}</p>
                    <p className="text-slate-400">
                      登记 {acc.total} 只 · 在柜 {acc.stored} · 借出 {acc.loaned} · 出柜 {acc.takenOut} · 待安排{' '}
                      <b className="text-amber-600">{acc.pending}</b>
                    </p>
                    <button className="btn-ghost mt-1 !px-2 !py-0.5 text-xs" type="button" onClick={() => startSplit(specimen.id, false)}>
                      {acc.stored > 0 ? '继续分装' : '分装'}
                    </button>
                  </div>
                )
              })}
              {pendingSpecimens.length === 0 ? <p className="text-xs text-slate-400">所有只数都已安排去向</p> : null}
            </div>
          </div>

          {/* 已入柜明细 */}
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">插位明细（只数按插位）</h2>
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-auto text-xs">
              {storages.map((storage) => (
                <li key={storage.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                  <button type="button" className="text-left" onClick={() => setDetail(storage)}>
                    <span className="font-mono text-field-700">{storageSlotText(storage)}</span>
                    <span className="ml-2 text-slate-600">{codeOf(storage.specimenId)}</span>
                    <span className="ml-1 text-slate-400">
                      {storage.method} · {storage.count} 只
                    </span>
                  </button>
                </li>
              ))}
              {storages.length === 0 ? <li className="text-slate-400">暂无入柜记录</li> : null}
            </ul>
          </div>

          {/* 插位操作：出柜 / 借出 按只数 */}
          {detail ? (
            <div className="panel" data-testid="slot-detail">
              <h2 className="text-sm font-semibold text-slate-700">插位操作 · {storageSlotText(detail)}</h2>
              <p className="mt-1 text-xs text-slate-600">
                {codeOf(detail.specimenId)} · {detail.method} · 当前 {detail.count} 只 · 入柜 {detail.storedDate} · 经手{' '}
                {detail.handler || '—'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={detail.count}
                  className="field-input w-20"
                  value={opCount}
                  onChange={(e) => setOpCount(e.target.value)}
                  aria-label="只数"
                />
                <span className="text-xs text-slate-400">只（1–{detail.count}）</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="field-input flex-1" value={takeReason} onChange={(e) => setTakeReason(e.target.value)} placeholder="出柜原因（如 提取解剖）" />
                <button className="btn-danger" type="button" onClick={() => void runTakeOut()}>
                  按只出柜
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="field-input flex-1" value={borrower} onChange={(e) => setBorrower(e.target.value)} placeholder="借用人 / 单位" />
                <button className="btn-primary" type="button" onClick={() => void runLoan()}>
                  按只借出
                </button>
              </div>
              {opError ? <p className="mt-2 text-xs text-rose-600">{opError}</p> : null}
              <button className="btn-ghost mt-2" type="button" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <p className="text-xs text-slate-400">
        提示：未分装的标本不在柜位图占插位；旧数据升级后每份仍只占一个插位，只数自动补为登记总数。
      </p>
    </div>
  )
}
