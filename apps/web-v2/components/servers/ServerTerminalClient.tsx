"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { RefreshCw, TerminalSquare, Wifi, WifiOff } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import type { ServerStatus } from "@/lib/types";

type ConnState = "connecting" | "open" | "closed" | "error";

interface Props {
  teamId: string;
  serverId: string;
  hostname: string;
  sshUser: string;
  sshPort: number;
  status: ServerStatus;
}

export function ServerTerminalClient({
  teamId,
  serverId,
  hostname,
  sshUser,
  sshPort,
  status,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [generation, setGeneration] = useState(0);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    wsRef.current?.close();
    xtermRef.current?.dispose();

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono), Menlo, Monaco, Consolas, monospace",
      // Match the Mission Control palette — graphite background with signal amber accents.
      theme: {
        background: "#0f1012",
        foreground: "#e7e5e4",
        cursor: "#f5a623",
        cursorAccent: "#0f1012",
        selectionBackground: "#3f3a2c",
        black: "#15161e",
        red: "#f17a85",
        green: "#a4cf76",
        yellow: "#f5a623",
        blue: "#7aa2f7",
        magenta: "#c894f0",
        cyan: "#7dcfff",
        white: "#c2c0bf",
        brightBlack: "#5a5a5a",
        brightRed: "#f17a85",
        brightGreen: "#a4cf76",
        brightYellow: "#f5a623",
        brightBlue: "#7aa2f7",
        brightMagenta: "#c894f0",
        brightCyan: "#7dcfff",
        brightWhite: "#ffffff",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    term.writeln(`\x1b[2mConnecting to ${sshUser}@${hostname}:${sshPort}...\x1b[0m`);
    setConn("connecting");

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/v1/teams/${teamId}/servers/${serverId}/terminal`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConn("open");
      const dims = fit.proposeDimensions();
      if (dims) ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        event.data.text().then((text) => term.write(text));
      } else {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      setConn("error");
      term.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
    };

    ws.onclose = (event) => {
      setConn("closed");
      term.writeln(`\r\n\x1b[33mSession closed (code: ${event.code}). Press Enter or click Reconnect.\x1b[0m`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      } else if (ws.readyState === WebSocket.CLOSED && data === "\r") {
        setGeneration((g) => g + 1);
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const dims = fit.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [teamId, serverId, hostname, sshUser, sshPort]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      wsRef.current?.close();
      xtermRef.current?.dispose();
      wsRef.current = null;
      xtermRef.current = null;
    };
  }, [connect, generation]);

  if (status === "offline" || status === "provisioning") {
    return (
      <EmptyState
        icon={<TerminalSquare className="h-4 w-4" />}
        title={status === "provisioning" ? "Server is provisioning" : "Server is offline"}
        body="A live SSH terminal requires the server to be reachable. Bring it online and try again."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <div className="label-mono mb-1 flex items-center gap-2">
            <TerminalSquare className="h-3 w-3" /> SSH terminal
          </div>
          <h2 className="text-[16px] text-ink-1">
            <span className="font-mono text-ink-2">{sshUser}@{hostname}</span>
            <span className="text-ink-3">:{sshPort}</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill state={conn} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setGeneration((g) => g + 1)}
            aria-label="Reconnect"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="ml-1.5">Reconnect</span>
          </Button>
        </div>
      </CardHeader>
      <CardBody className="pt-3">
        <div
          className="rounded-[var(--radius-sm)] border border-line-1 overflow-hidden"
          style={{ background: "#0f1012" }}
        >
          <div
            ref={containerRef}
            className="w-full"
            style={{ height: 520, padding: "12px 12px 4px" }}
          />
        </div>
        <p className="mt-3 text-[11px] text-ink-3 font-mono">
          Tip: PTY size follows the panel. Type <span className="text-ink-2">exit</span> to end the session.
        </p>
      </CardBody>
    </Card>
  );
}

function StatusPill({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; klass: string; Icon: typeof Wifi }> = {
    connecting: {
      label: "Connecting",
      klass: "text-warn border-warn/40 bg-warn/10",
      Icon: Wifi,
    },
    open: {
      label: "Connected",
      klass: "text-online border-online/40 bg-online/10",
      Icon: Wifi,
    },
    closed: {
      label: "Closed",
      klass: "text-ink-3 border-line-1 bg-surface-2",
      Icon: WifiOff,
    },
    error: {
      label: "Error",
      klass: "text-alert border-alert/40 bg-alert/10",
      Icon: WifiOff,
    },
  };
  const { label, klass, Icon } = map[state];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
        "font-mono text-[10px] uppercase tracking-[0.14em] " +
        klass
      }
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
