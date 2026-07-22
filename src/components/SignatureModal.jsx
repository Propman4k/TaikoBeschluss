import { useEffect, useRef, useState } from 'react'
import { Eraser, Check, FileSignature } from 'lucide-react'

// 1:1 aus TaikoEat uebernommen: pro Oeffnen zufaellige Stiftfarbe + Strichstaerke.
const INK_COLORS = ['#111827', '#1e3a8a', '#1d4ed8']
const randomStyle = () => ({
  color: INK_COLORS[Math.floor(Math.random() * INK_COLORS.length)],
  width: 1.6 + Math.random() * 1.4, // 1.6–3.0 px
})

const W = 560
const H = 200

export default function SignatureModal({ onSave, onClose, existingUrl, templateUrl }) {
  const canvasRef = useRef(null)
  const drawing = useRef(null)
  const [style] = useState(randomStyle)
  const [hasStroke, setHasStroke] = useState(false)
  const [saving, setSaving] = useState(false)

  // Ein Bild (bestehende Unterschrift oder Vorlage) mittig auf das Canvas zeichnen
  function drawImageUrl(url) {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, W, H)
      const h = Math.min(H - 24, img.height)
      const w = img.width * (h / img.height)
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      setHasStroke(true)
    }
    img.src = url
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.width
    if (existingUrl) drawImageUrl(existingUrl)
  }, [style, existingUrl])

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e) {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawing.current = pos(e)
  }

  function move(e) {
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    const prev = drawing.current
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    drawing.current = p
    setHasStroke(true)
  }

  function up() {
    drawing.current = null
  }

  function clear() {
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    setHasStroke(false)
  }

  async function save() {
    setSaving(true)
    if (!hasStroke) {
      try {
        await onSave(null)
      } finally {
        setSaving(false)
      }
      return
    }
    canvasRef.current.toBlob(async (blob) => {
      try {
        await onSave(blob)
      } finally {
        setSaving(false)
      }
    }, 'image/png')
  }

  const canRemove = existingUrl && !hasStroke

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
    >
      <div className="relative bg-surface rounded-2xl shadow-elevated animate-modal-in overflow-hidden border border-border">
        <div className="px-6 py-4 border-b border-border bg-slate-50 flex items-center justify-between">
          <span className="font-semibold">Unterschrift leisten</span>
          <span className="text-xs text-text-muted">Maus oder Touchpad, wie auf Papier</span>
        </div>
        <div className="p-6">
          <canvas
            ref={canvasRef}
            style={{ width: W, height: H, touchAction: 'none' }}
            className="bg-white border border-dashed border-slate-300 rounded-[6px] cursor-crosshair"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={clear}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Eraser size={14} /> Löschen
              </button>
              {!!templateUrl && (
                <button
                  onClick={() => drawImageUrl(`${templateUrl}${templateUrl.includes('?') ? '&' : '?'}t=${Date.now()}`)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-brand bg-blue-50 border border-brand/30 rounded-[6px] hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <FileSignature size={14} /> Vorlage nutzen
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                onClick={save}
                disabled={(!hasStroke && !canRemove) || saving}
                className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-[6px] transition-colors cursor-pointer ${
                  canRemove
                    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-600/50'
                    : 'bg-brand hover:bg-brand-hover disabled:bg-brand/50'
                }`}
              >
                <Check size={14} /> {canRemove ? 'Unterschrift entfernen' : 'Übernehmen'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
