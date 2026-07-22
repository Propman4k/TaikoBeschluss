import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  const show = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {!!toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] animate-toast-in">
          <div
            className={`flex items-center gap-2 text-white px-5 py-3 rounded-[6px] shadow-lg text-sm font-medium ${
              toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
