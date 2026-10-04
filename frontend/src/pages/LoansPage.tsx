import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { storageStore } from '@/stores/storageStore'
import { loanStore } from '@/stores/loanStore'
import { movementStore } from '@/stores/movementStore'
import { accountsOf, loanRemaining } from '@/utils/stock'
import { specimenTaxon, storageSlotText } from '@/utils/codec'

/** 借出归还：出柜外借按只数算，支持部分归还；归还只数回补到该份现有插位 */
export default function LoansPage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)
  const loans = usePersistentStore(loanStore, (state) => state.rows)
  const movements = usePersistentStore(movementStore, (state) => state.rows)

  const [repayLoanId, setRepayLoanId] = useState('')
  const [repayCount, setRepayCount] = useState('1')
  const [repayStorageId, setRepayStorageId] = useState('')
  const [repayHandler, setRepayHandler] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const specimenMap = useMemo(() => new Map(specimens.map((item) => [item.id, item])), [specimens])
  const codeOf = (id: string): string => specimenMap.get(id)?.code ?? '未知'
  const slotText = (id: string): string => {
    const slot = storages.find((item) => item.id === id)
    return slot ? storageSlotText(slot) : '（插位已调整）'
  }

  const activeLoans = loans.filter((loan) => !loan.isReturn && loanRemaining(loans, loan) > 0)
  const repayLoan = activeLoans.find((loan) => loan.id === repayLoanId)
  const repayTargets = repayLoan ? storages.filter((item) => item.specimenId === repayLoan.specimenId) : []

  const accountsSummary = specimens.map((specimen) => ({
    specimen,
    acc: accountsOf(specimen, storages, loans, movements)
  }))
  const unbalanced = accountsSummary.filter(({ acc }) => !acc.balanced)

  const submitRepay = async (): Promise<void> => {
    if (!repayLoan) {
      setError('请选择要归还的借出记录')
      return
    }
    if (!repayStorageId) {
      setError('请选择放回插位（该份当前在柜插位；无在柜插位请先到柜位图分装）')
      return
    }
    const result = await loanStore.getState().repay({
      loanId: repayLoan.id,
      count: Number(repayCount),
      storageId: repayStorageId,
      date: new Date().toISOString().slice(0, 10),
      handler: repayHandler
    })
    if (!result.ok) {
      setError(result.error ?? '归还失败，已回滚')
      return
    }
    setMessage(`${codeOf(repayLoan.specimenId)} 归还 ${repayCount} 只至 ${slotText(repayStorageId)}`)
    setError('')
    setRepayCount('1')
    setRepayLoanId('')
    setRepayStorageId('')
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">借出归还</h1>
        <p className="page-sub">
          借出与归还均按只数算，从具体插位扣减 / 回补；可分批归还。账实恒等式：登记总数 ＝ 在柜 ＋ 借出中 ＋ 已出柜。
        </p>
      </header>

      {error ? <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-field-100 bg-field-50 px-3 py-2 text-sm text-field-700">{message}</p> : null}

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">归还登记</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <span className="field-label">借出记录</span>
            <select
              className="field-input"
              value={repayLoanId}
              onChange={(e) => {
                setRepayLoanId(e.target.value)
                setRepayStorageId('')
                const loan = activeLoans.find((item) => item.id === e.target.value)
                if (loan) {
                  const target = storages.find((item) => item.specimenId === loan.specimenId)
                  setRepayStorageId(target?.id ?? '')
                  setRepayCount(String(loanRemaining(loans, loan)))
                }
              }}
            >
              <option value="">请选择未结清的借出</option>
              {activeLoans.map((loan) => (
                <option key={loan.id} value={loan.id}>
                  {codeOf(loan.specimenId)} · {loan.borrower} · 未还 {loanRemaining(loans, loan)}/{loan.count} 只 · 借于{' '}
                  {loan.date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">本次归还只数</span>
            <input
              type="number"
              min={1}
              className="field-input"
              value={repayCount}
              onChange={(e) => setRepayCount(e.target.value)}
            />
          </div>
          <div>
            <span className="field-label">放回插位</span>
            <select className="field-input" value={repayStorageId} onChange={(e) => setRepayStorageId(e.target.value)}>
              <option value="">请选择在柜插位</option>
              {repayTargets.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {storageSlotText(slot)}（现 {slot.count} 只）
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">经手人</span>
            <input className="field-input" value={repayHandler} onChange={(e) => setRepayHandler(e.target.value)} placeholder="如 覃羽" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-primary" type="button" onClick={() => void submitRepay()} data-testid="submit-repay">
            确认归还
          </button>
          {repayTargets.length === 0 && repayLoan ? (
            <span className="text-xs text-amber-600">该份当前没有在柜插位，请先到</span>
          ) : null}
          {repayTargets.length === 0 && repayLoan ? (
            <Link className="text-xs text-field-700 underline" to="/storage">
              保藏柜位图
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">借出中（{activeLoans.length} 笔）</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">借用人/单位</th>
                <th className="border border-slate-200 px-2 py-1">借出只数</th>
                <th className="border border-slate-200 px-2 py-1">未还</th>
                <th className="border border-slate-200 px-2 py-1">借出日</th>
                <th className="border border-slate-200 px-2 py-1">应还日</th>
                <th className="border border-slate-200 px-2 py-1">原插位</th>
                <th className="border border-slate-200 px-2 py-1">经手/备注</th>
              </tr>
            </thead>
            <tbody>
              {activeLoans.map((loan) => (
                <tr key={loan.id}>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-field-700">{codeOf(loan.specimenId)}</td>
                  <td className="border border-slate-200 px-2 py-1">{loan.borrower}</td>
                  <td className="border border-slate-200 px-2 py-1">{loan.count}</td>
                  <td className="border border-slate-200 px-2 py-1 font-semibold">{loanRemaining(loans, loan)}</td>
                  <td className="border border-slate-200 px-2 py-1">{loan.date}</td>
                  <td className="border border-slate-200 px-2 py-1">{loan.dueDate || '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 font-mono">{slotText(loan.storageId)}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    {loan.handler || '—'}
                    {loan.note ? ` · ${loan.note}` : ''}
                  </td>
                </tr>
              ))}
              {activeLoans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border border-slate-200 px-2 py-3 text-center text-slate-400">
                    没有未结清借出
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">出柜流水（按只数永久出柜）</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="border border-slate-200 px-2 py-1">日期</th>
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">出柜插位</th>
                <th className="border border-slate-200 px-2 py-1">只数</th>
                <th className="border border-slate-200 px-2 py-1">原因</th>
                <th className="border border-slate-200 px-2 py-1">经手/备注</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="border border-slate-200 px-2 py-1">{movement.date}</td>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-field-700">{codeOf(movement.specimenId)}</td>
                  <td className="border border-slate-200 px-2 py-1 font-mono">{slotText(movement.storageId)}</td>
                  <td className="border border-slate-200 px-2 py-1 font-semibold">{movement.count}</td>
                  <td className="border border-slate-200 px-2 py-1">{movement.reason || '—'}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    {movement.handler || '—'}
                    {movement.note ? ` · ${movement.note}` : ''}
                  </td>
                </tr>
              ))}
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="border border-slate-200 px-2 py-3 text-center text-slate-400">
                    暂无出柜流水
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">账实核对（按只数盘点）</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">类群</th>
                <th className="border border-slate-200 px-2 py-1">登记总数</th>
                <th className="border border-slate-200 px-2 py-1">在柜</th>
                <th className="border border-slate-200 px-2 py-1">借出中</th>
                <th className="border border-slate-200 px-2 py-1">已出柜</th>
                <th className="border border-slate-200 px-2 py-1">占用插位</th>
                <th className="border border-slate-200 px-2 py-1">核对</th>
              </tr>
            </thead>
            <tbody>
              {accountsSummary.map(({ specimen, acc }) => (
                <tr key={specimen.id}>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-field-700">{specimen.code}</td>
                  <td className="border border-slate-200 px-2 py-1">{specimenTaxon(specimen)}</td>
                  <td className="border border-slate-200 px-2 py-1 font-semibold">{acc.total}</td>
                  <td className="border border-slate-200 px-2 py-1">{acc.stored}</td>
                  <td className="border border-slate-200 px-2 py-1">{acc.loaned}</td>
                  <td className="border border-slate-200 px-2 py-1">{acc.takenOut}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    {storages.filter((item) => item.specimenId === specimen.id).length}
                  </td>
                  <td className={`border border-slate-200 px-2 py-1 ${acc.balanced ? 'text-field-700' : 'text-rose-600'}`}>
                    {acc.balanced ? '平' : '不平'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unbalanced.length > 0 ? (
          <p className="mt-2 text-xs text-rose-600">
            {unbalanced.map(({ specimen }) => specimen.code).join('、')} 账实不平，请检查分装只数或出柜/借出流水。
          </p>
        ) : null}
      </section>
    </div>
  )
}
