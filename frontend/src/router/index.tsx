import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '@/App'
import SpecimensPage from '@/pages/SpecimensPage'
import SitesPage from '@/pages/SitesPage'
import CollectPage from '@/pages/CollectPage'
import DeterminationPage from '@/pages/DeterminationPage'
import StoragePage from '@/pages/StoragePage'
import LoansPage from '@/pages/LoansPage'

/** 前端路由：/specimens /collect /sites /determination /storage /loans */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/specimens" replace />} />
        <Route path="/specimens" element={<SpecimensPage />} />
        <Route path="/collect" element={<CollectPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/determination" element={<DeterminationPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/loans" element={<LoansPage />} />
        <Route path="*" element={<Navigate to="/specimens" replace />} />
      </Route>
    </Routes>
  )
}
