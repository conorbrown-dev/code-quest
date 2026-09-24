import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { AnalyticsDashboard } from './AnalyticsDashboard'

const root = document.getElementById('root')!
const analyticsRoute = window.location.pathname === '/analytics' || window.location.pathname === '/analytics/'

createRoot(root).render(
  <StrictMode>
    {analyticsRoute ? <AnalyticsDashboard /> : <App />}
  </StrictMode>,
)
