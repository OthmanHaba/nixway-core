import { useEffect, useState } from 'react'

export function useSSE(url: string | null) {
  const [messages, setMessages] = useState<string[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!url) return

    const source = new EventSource(url, { withCredentials: true })
    setConnected(true)

    source.onmessage = (event) => {
      setMessages(prev => [...prev, event.data])
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
    }

    return () => {
      source.close()
      setConnected(false)
    }
  }, [url])

  return { messages, connected, clear: () => setMessages([]) }
}
