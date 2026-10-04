import { useMemo, useState } from 'react'
import type { Loan, Storage, StorageMethod } from '@/types'
import { STORAGE_METHODS } from '@/types'
import CabinetGrid from '@/components/common/CabinetGrid'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { storageStore } from '@/stores/storageStore'
import { loanStore } from '@/stores/loanStore'
import { siteStore } from '@/stores/siteStore'
import { encodeSlot, placedCountOf, remainingCountOf, specimenTaxon, storageSlotText } from '@/utils/codec'

/** 保藏柜位图：柜-抽屉-盒-位展开，插位分装（一份散放多位，按插位记只数），出柜/借出按只数 */
export default function StoragePage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)
  const loans = usePersistentStore(loanStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)

  const [cabinet, setCabinet] = useState('C01')
  const [drawers, setDrawers] = useState(2)
  const [boxes, setBoxes] = useState(3)
  const [slots, setSlots] = useState(8)
  const [method, setMethod] = useState<StorageMethod>('针插')
  const [handler, setHandler] = useState('')
  const [picked, setPicked] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [countInput, setCountInput] = useState(1)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [detail, setDetail] = useState<Storage | null>(null)
  const [takeOutCount, setTakeOutCount] = useState(1)
  const [loanCount, setLoanCount] = useState(1)
  const [loanBorrower, setLoanBorrower] = useState('')

  const codeOf = (specimenId: string): string => specimens.find((item) => item.id === specimenId)?.code ?? '未知'
  const siteName = (siteId: string): string => sites.find((site) => site.id === siteId)?.name ?? '未关联采集地'

  /** 各标本已入柜只数 */
  const placedMap = useMemo(() => {
    const map = new Map<string, number>()
    storages.forEach((row) => map.set(row.specimenId, (map.get(row.specimenId) ?? 0) + (Number(row.count) || 0)))
    return map
  }, [storages])

  /** 还可入柜的标本（采集登记管个体总数，库房管插位分装） */
  const placeable = specimens.filter((item) => remainingCountOf(item, storages) > 0)
  const pickedSpecimen = specimens.find((item) => item.id === picked)
  const pickedRemaining = pickedSpecimen ? remainingCountOf(pickedSpecimen, storages) : 0

  const pickSpecimen = (id: string): void => {
    setPicked(id)
    const target = specimens.find((item) => item.id === id)
    setCountInput(target ? remainingCountOf(target, storages) : 1)
  }

  const place = async (position: { cabinet: string; drawer: number; box: number; slot: number }): Promise<void> => {
    const specimenId = dragging ?? picked
    if (!specimenId) {
      setWarning('请先在右侧选择或拖动一份标本')
      return
    }
    const specimen = specimens.find((item) => item.id === specimenId)
    if (!specimen) return
    const want = Math.max(1, Math.floor(Number(countInput) || 0))
    const result = await storageStore.getState().place(specimen, position, want, method, handler.trim())
    if (result.conflict) {
      setWarning(
        `柜位 ${encodeSlot(position.cabinet, position.drawer, position.box, position.slot)} 已被其他标本占用，` +
          '请换一个插位（同一份标本可散放多个插位）'
      )
      return
    }
    setWarning('')
    if (result.placed > 0) {
      let text = `${specimen.code} 已入柜 ${encodeSlot(position.cabinet, position.drawer, position.box, position.slot)} ${result.placed} 只`
      if (result.rejected > 0) {
        text += `；${result.rejected} 只没放下已退回（该份总数 ${specimen.quantity} 只，已放 ${placedCountOf(storages, specimen.id) + result.placed} 只）`
      }
      setMessage(text)
      // 刷新选中标本的剩余只数，便于继续分装到下一个插位
      setCountInput(Math.max(0, remainingCountOf(specimen, storageStore.getState().rows)))
    } else {
      setWarning(`${specimen.code} 的 ${want} 只没放下：该份总数 ${specimen.quantity} 只，已全部入柜`)
    }
    setDragging(null)
  }

  const openDetail = (storage: Storage): void => {
    setDetail(storage)
    setTakeOutCount(storage.count)
    setLoanCount(1)
    setLoanBorrower('')
  }

  const takeOut = async (storage: Storage, count: number): Promise<void> => {
    const want = Math.max(1, Math.floor(Number(count) || 0))
    const remaining = await storageStore.getState().takeOut(storage, want)
    if (remaining > 0) {
      setMessage(`${codeOf(storage.specimenId)} 从 ${storageSlotText(storage)} 出柜 ${want} 只，该插位剩 ${remaining} 只`)
      setDetail({ ...storage, count: remaining })
      setTakeOutCount(remaining)
    } else {
      setMessage(`${codeOf(storage.specimenId)} 从 ${storageSlotText(storage)} 出柜 ${want} 只，插位已清空`)
      setDetail(null)
    }
  }

  const loanOfSpecimen = (specimenId: string): Loan[] =>
    loans
      .filter((item) => item.specimenId === specimenId)
      .sort((a, b) => Number(a.returnedDate === '') - Number(b.returnedDate === '') || b.loanDate.localeCompare(a.loanDate))

  const activeLoanCount = (specimenId: string): number =>
    loans.filter((item) => item.specimenId === specimenId && !item.returnedDate).reduce((sum, item) => sum + item.count, 0)

  const loan = async (specimenId: string): Promise<void> => {
    const want = Math.max(1, Math.floor(Number(loanCount) || 0))
    const specimen = specimens.find((item) => item.id === specimenId)
    if (specimen && activeLoanCount(specimenId) + want > specimen.quantity) {
      setWarning(`借出只数超过该份标本总数（${specimen.quantity} 只），请调小借出数量`)
      return
    }
    await loanStore.getState().loan(specimenId, want, loanBorrower)
    setMessage(`${codeOf(specimenId)} 借出 ${want} 只${loanBorrower.trim() ? `给 ${loanBorrower.trim()}` : ''}`)
    setLoanCount(1)
    setLoanBorrower('')
  }

  const giveBack = async (loanId: string): Promise<void> => {
    await loanStore.getState().giveBack(loanId)
    setMessage('借出标本已归还')
  }

  const totalInCabinet = storages.reduce((sum, row) => sum + (Number(row.count) || 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">保藏柜位图</h1>
        <p className="page-sub">
          按柜—抽屉—盒三级展开插位；一份标本可散放多个插位，每个插位只放一部分，只数按插位记，超出总数的部分自动退回。
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
          <span className="field-label">保藏方式</span>
          <select className="field-input w-28" value={method} onChange={(e) => setMethod(e.target.value as StorageMethod)}>
            {STORAGE_METHODS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-label">入柜只数</span>
          <input
            type="number"
            min={1}
            className="field-input w-24"
            value={countInput}
            onChange={(e) => setCountInput(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div>
          <span className="field-label">经手人</span>
          <input className="field-input w-32" value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="如 覃羽" />
        </div>
        <div className="text-xs text-slate-500">
          在柜 {totalInCabinet} 只 · 插位 {storages.length} 个 · 可分装 {placeable.length} 份
          {pickedSpecimen ? ` · 当前选中 ${pickedSpecimen.code}（还可放 ${pickedRemaining} 只）` : ''}
        </div>
      </section>

      {warning ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p> : null}
      {message ? <p className="rounded-lg border border-field-100 bg-field-50 px-3 py-2 text-sm text-field-700">{message}</p> : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <CabinetGrid
          cabinet={cabinet}
          drawers={drawers}
          boxes={boxes}
          slots={slots}
          storages={storages}
          codeOf={codeOf}
          draggingCode={dragging ? codeOf(dragging) : picked ? codeOf(picked) : null}
          onDropSlot={(position) => void place(position)}
          onPickStorage={(storage) => openDetail(storage)}
        />

        <div className="flex flex-col gap-4">
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">未入柜标本（拖到插位，可分装多个插位）</h2>
            <div className="mt-2 max-h-72 space-y-2 overflow-auto">
              {placeable.map((specimen) => {
                const placed = placedMap.get(specimen.id) ?? 0
                const remaining = specimen.quantity - placed
                return (
                  <div
                    key={specimen.id}
                    draggable
                    onDragStart={() => setDragging(specimen.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => pickSpecimen(specimen.id)}
                    className={`cursor-grab rounded-lg border px-3 py-2 text-xs transition ${
                      picked === specimen.id ? 'border-field-500 bg-field-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-mono text-field-700">{specimen.code}</p>
                    <p className="text-slate-600">{specimenTaxon(specimen)}</p>
                    <p className="text-slate-400">
                      {siteName(specimen.siteId)} · <StatusTag status={specimen.status} />
                    </p>
                    <p className="mt-1 text-slate-500">
                      总数 {specimen.quantity} 只 · 已放 {placed} 只 · <span className="text-field-700">还可放 {remaining} 只</span>
                    </p>
                  </div>
                )
              })}
              {placeable.length === 0 ? <p className="text-xs text-slate-400">所有标本都已入柜</p> : null}
            </div>
          </div>

          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">已入柜明细（按插位记只数）</h2>
            <ul className="mt-2 space-y-1.5 text-xs">
              {storages.map((storage) => (
                <li key={storage.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                  <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => openDetail(storage)}>
                    <span className="font-mono text-field-700">{storageSlotText(storage)}</span>
                    <span className="truncate text-slate-600">{codeOf(storage.specimenId)}</span>
                    <span className="shrink-0 text-slate-400">{storage.method}</span>
                    <span className="shrink-0 font-semibold text-field-700">{storage.count} 只</span>
                  </button>
                  <button className="btn-danger shrink-0" type="button" onClick={() => void takeOut(storage, storage.count)}>
                    出柜
                  </button>
                </li>
              ))}
              {storages.length === 0 ? <li className="text-slate-400">暂无入柜记录</li> : null}
            </ul>
          </div>

          {detail ? (
            <div className="panel">
              <h2 className="text-sm font-semibold text-slate-700">插位明细</h2>
              <p className="mt-1 text-xs text-slate-600">
                柜位 {storageSlotText(detail)} · {detail.method} · 入柜日期 {detail.storedDate} · 经手人 {detail.handler || '—'}
              </p>
              <p className="text-xs text-slate-600">
                标本：{codeOf(detail.specimenId)} · 该插位 <b>{detail.count}</b> 只
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">出柜</span>
                <input
                  type="number"
                  min={1}
                  max={detail.count}
                  className="field-input w-20"
                  value={takeOutCount}
                  onChange={(e) => setTakeOutCount(Math.max(1, Number(e.target.value) || 1))}
                />
                <span className="text-xs text-slate-500">只</span>
                <button className="btn-danger" type="button" onClick={() => void takeOut(detail, takeOutCount)}>
                  部分出柜
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">借出</span>
                <input
                  type="number"
                  min={1}
                  className="field-input w-20"
                  value={loanCount}
                  onChange={(e) => setLoanCount(Math.max(1, Number(e.target.value) || 1))}
                />
                <input
                  className="field-input w-28"
                  value={loanBorrower}
                  onChange={(e) => setLoanBorrower(e.target.value)}
                  placeholder="借出人"
                />
                <button className="btn-ghost" type="button" onClick={() => void loan(detail.specimenId)}>
                  借出登记
                </button>
              </div>

              {loanOfSpecimen(detail.specimenId).length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {loanOfSpecimen(detail.specimenId).map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1">
                      <span className="text-slate-600">
                        {item.count} 只 · {item.borrower} · {item.loanDate}
                        {item.returnedDate ? <span className="text-slate-400">（已于 {item.returnedDate} 归还）</span> : <span className="text-amber-700">（借出中）</span>}
                      </span>
                      {!item.returnedDate ? (
                        <button className="btn-ghost shrink-0" type="button" onClick={() => void giveBack(item.id)}>
                          归还
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              <button className="btn-ghost mt-2" type="button" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
