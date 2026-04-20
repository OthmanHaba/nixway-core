import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  teamId: string
  serverId: string
}

export function Terminal({ teamId, serverId }: TerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const connect = useCallback(() => {
    if (!termRef.current) return

    // Clean up previous
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Build WebSocket URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/api/v1/teams/${teamId}/servers/${serverId}/terminal`

    term.writeln('Connecting to server...')

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send initial size
      const dims = fitAddon.proposeDimensions()
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    }

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        event.data.text().then((text: string) => term.write(text))
      } else {
        term.write(event.data)
      }
    }

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31mWebSocket error. Check connection.\x1b[0m')
    }

    ws.onclose = (event) => {
      term.writeln(`\r\n\x1b[33mConnection closed (code: ${event.code}).\x1b[0m`)
      term.writeln('Press Enter to reconnect...')
    }

    // Terminal input -> WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      } else if (ws.readyState === WebSocket.CLOSED && data === '\r') {
        // Reconnect on Enter when disconnected
        connect()
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      const dims = fitAddon.proposeDimensions()
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [teamId, serverId])

  useEffect(() => {
    const cleanup = connect()
    return () => {
      cleanup?.()
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [connect])

  return (
    <div
      ref={termRef}
      className="w-full rounded-md overflow-hidden border"
      style={{ height: '500px' }}
    />
  )
}
