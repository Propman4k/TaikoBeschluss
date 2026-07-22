import { FileSignature } from 'lucide-react'

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-surface rounded-[10px] shadow-card border border-border px-10 py-12 text-center max-w-sm w-full mx-4">
        <div className="flex items-center justify-center gap-2 text-brand font-bold text-2xl mb-2">
          <FileSignature size={28} strokeWidth={2.5} />
          TaikoBeschluss
        </div>
        <p className="text-sm text-text-muted mb-8">
          Gesellschafterbeschlüsse erstellen, freigeben und unterschreiben.
        </p>
        <a
          href="/api/auth/google"
          className="inline-flex items-center justify-center gap-2 w-full px-5 py-2.5 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors"
        >
          Mit Google anmelden
        </a>
      </div>
    </div>
  )
}
