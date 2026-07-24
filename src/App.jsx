import { useEffect, useState, useCallback } from 'react'
import { Menu, FileSignature } from 'lucide-react'
import { api } from './api.js'
import Login from './pages/Login.jsx'
import Resolutions from './pages/Resolutions.jsx'
import Editor from './pages/Editor.jsx'
import Companies from './pages/Companies.jsx'
import Shareholders from './pages/Shareholders.jsx'
import Organigram from './pages/Organigram.jsx'
import Trash from './pages/Trash.jsx'
import Settings from './pages/Settings.jsx'
import Sidebar from './components/Sidebar.jsx'
import { ToastProvider } from './components/Toast.jsx'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '')
}

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = laedt, null = ausgeloggt
  const [counts, setCounts] = useState({ entwuerfe: 0, offen: 0, abgeschlossen: 0, papierkorb: 0 })
  const [mobileNav, setMobileNav] = useState(false)
  const route = useHashRoute()

  useEffect(() => setMobileNav(false), [route])

  const loadMe = useCallback(() => {
    api.get('/api/auth/me').then(setUser).catch(() => setUser(null))
  }, [])

  useEffect(loadMe, [loadMe])
  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener('auth-expired', onExpired)
    return () => window.removeEventListener('auth-expired', onExpired)
  }, [])

  // Zaehler fuer die Sidebar bei jedem Seitenwechsel aktualisieren
  useEffect(() => {
    if (!user) return
    Promise.all([api.get('/api/resolutions'), api.get('/api/resolutions/trash')])
      .then(([d, trash]) => {
        const done = d.resolutions.filter((r) => r.sig_total > 0 && r.sig_done >= r.sig_total).length
        const entwuerfe = d.resolutions.filter((r) => r.status === 'entwurf').length
        setCounts({
          entwuerfe,
          offen: d.resolutions.length - done - entwuerfe,
          abgeschlossen: done,
          papierkorb: trash.length,
        })
      })
      .catch(() => {})
  }, [user, route])

  if (user === undefined) return null
  if (user === null) return <Login />

  const editorMatch = route.match(/^beschluss\/(\d+)$/)

  return (
    <ToastProvider>
      <div className="min-h-screen bg-surface-raised flex border-t border-border">
        <Sidebar
          route={route}
          user={user}
          counts={counts}
          mobileOpen={mobileNav}
          onClose={() => setMobileNav(false)}
        />
        <div className="flex-1 min-w-0">
          <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 bg-surface/95 backdrop-blur border-b border-border">
            <button
              onClick={() => setMobileNav(true)}
              aria-label="Menü öffnen"
              className="p-1.5 -ml-1 rounded-lg text-slate-700 hover:bg-slate-100"
            >
              <Menu size={22} strokeWidth={2} />
            </button>
            <span className="flex items-center gap-2 text-brand font-bold">
              <FileSignature size={18} strokeWidth={2.5} /> TaikoBeschluss
            </span>
          </header>
          {editorMatch ? (
            <Editor id={Number(editorMatch[1])} />
          ) : (
            <main className="w-full px-4 sm:px-6 lg:px-10 py-6">
              {route === 'gesellschaften' ? (
                <Companies />
              ) : route === 'gesellschafter' ? (
                <Shareholders />
              ) : route === 'organigramm' ? (
                <Organigram />
              ) : route === 'papierkorb' ? (
                <Trash />
              ) : route === 'einstellungen' ? (
                <Settings />
              ) : route === 'entwuerfe' ? (
                <Resolutions view="entwuerfe" />
              ) : route === 'abgeschlossen' ? (
                <Resolutions view="abgeschlossen" />
              ) : (
                <Resolutions view="offen" />
              )}
            </main>
          )}
        </div>
      </div>
    </ToastProvider>
  )
}
