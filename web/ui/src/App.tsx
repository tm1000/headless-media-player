import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Upload, Trash2, Download, Play, GripVertical, Film } from 'lucide-react'

type Status = {
  filename: string | null
  elapsed: number
  duration: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<Status>({ filename: null, elapsed: 0, duration: 0 })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const onThumbnailError = (filename: string) => {
    setThumbErrors(prev => new Set([...prev, filename]))
    setTimeout(() => {
      setThumbErrors(prev => {
        const next = new Set(prev)
        next.delete(filename)
        return next
      })
    }, 2000)
  }

  const refresh = async () => {
    const res = await fetch('/api/list')
    const data = await res.json()
    setFiles(data)
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch('/api/status')
      const data = await res.json()
      setStatus(data)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const upload = async (fileList: FileList) => {
    setUploading(true)
    for (const f of Array.from(fileList)) {
      const form = new FormData()
      form.append('file', f)
      await fetch('/api/upload', { method: 'POST', body: form })
    }
    setUploading(false)
    refresh()
  }

  const del = async (name: string) => {
    await fetch('/api/delete/' + name, { method: 'DELETE' })
    refresh()
  }

  const play = async (name: string) => {
    await fetch('/api/play/' + name, { method: 'POST' })
  }

  const onFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
  }, [])

  const onItemDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const onItemDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const newFiles = [...files]
    const [moved] = newFiles.splice(dragIndex, 1)
    newFiles.splice(targetIndex, 0, moved)
    setFiles(newFiles)
    setDragIndex(null)
    setDragOverIndex(null)
    await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newFiles),
    })
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Signage Manager</h1>

        {status.filename && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <Play className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm font-medium text-green-900 truncate flex-1">{status.filename}</span>
              <span className="text-sm font-mono text-green-700 shrink-0">
                {formatTime(status.elapsed)} / {formatTime(status.duration)}
              </span>
            </CardContent>
          </Card>
        )}

        <Card
          className={`border-2 border-dashed cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }`}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onFileDrop}
          onClick={() => inputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {uploading ? 'Uploading...' : 'Drag & drop videos here, or click to browse'}
            </p>
          </CardContent>
        </Card>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />

        {files.length > 0 ? (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">
              Files <span className="text-muted-foreground font-normal">({files.length})</span>
            </h2>
            {files.map((f, i) => (
              <Card
                key={f}
                className={`transition-colors ${dragOverIndex === i && dragIndex !== i ? 'border-primary' : ''}`}
                draggable
                onDragStart={(e) => onItemDragStart(e, i)}
                onDragOver={(e) => onItemDragOver(e, i)}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={(e) => onItemDrop(e, i)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
              >
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
                  {thumbErrors.has(f) ? (
                    <div className="h-10 w-16 rounded shrink-0 bg-muted flex items-center justify-center">
                      <Film className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ) : (
                    <img
                      src={`/api/thumbnail/${f}`}
                      className="h-10 w-16 object-cover rounded shrink-0 bg-muted"
                      onError={() => onThumbnailError(f)}
                    />
                  )}
                  <span className="text-sm font-medium truncate flex-1">{f}</span>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="icon" onClick={() => play(f)} title="Play now">
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" asChild>
                      <a href={`/api/download/${f}`} download>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button variant="destructive" size="icon" onClick={() => del(f)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground text-sm py-4">No videos uploaded yet.</p>
        )}
      </div>
    </div>
  )
}
