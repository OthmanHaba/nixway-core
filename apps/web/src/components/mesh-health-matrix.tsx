import type { WireGuardPeer } from '@/lib/types'

interface Props {
  peers: WireGuardPeer[]
}

function qualityColor(peer: WireGuardPeer): string {
  if (peer.status === 'failed') return 'bg-red-500'
  if (peer.status === 'pending') return 'bg-gray-300 dark:bg-gray-600'
  if (peer.status === 'degraded') return 'bg-yellow-500'
  // active - color by RTT
  if (peer.rtt_ms == null) return 'bg-green-500'
  if (peer.rtt_ms < 10) return 'bg-green-500'
  if (peer.rtt_ms < 50) return 'bg-green-400'
  if (peer.rtt_ms < 200) return 'bg-yellow-500'
  return 'bg-red-500'
}

function qualityLabel(peer: WireGuardPeer): string {
  if (peer.status === 'failed') return 'failed'
  if (peer.status === 'pending') return 'pending'
  if (peer.status === 'degraded') return 'degraded'
  if (peer.rtt_ms == null) return 'active'
  if (peer.rtt_ms < 10) return 'excellent'
  if (peer.rtt_ms < 50) return 'good'
  if (peer.rtt_ms < 200) return 'fair'
  return 'poor'
}

export function MeshHealthMatrix({ peers }: Props) {
  if (peers.length === 0) {
    return <p className="text-sm text-muted-foreground">No peer connections yet.</p>
  }

  // Build unique server list from peers
  const serverMap = new Map<string, string>()
  for (const p of peers) {
    serverMap.set(p.from_ip, p.from_server_name)
    serverMap.set(p.to_ip, p.to_server_name)
  }
  const servers = Array.from(serverMap.entries()).map(([ip, name]) => ({ ip, name }))
  servers.sort((a, b) => a.ip.localeCompare(b.ip))

  // Build lookup: from_ip -> to_ip -> peer
  const matrix = new Map<string, Map<string, WireGuardPeer>>()
  for (const p of peers) {
    if (!matrix.has(p.from_ip)) matrix.set(p.from_ip, new Map())
    matrix.get(p.from_ip)!.set(p.to_ip, p)
  }

  const activePeers = peers.filter(p => p.status === 'active').length

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {activePeers}/{peers.length} links active
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left text-muted-foreground font-normal">From \ To</th>
              {servers.map((s) => (
                <th key={s.ip} className="p-2 text-center font-normal text-muted-foreground whitespace-nowrap">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {servers.map((from) => (
              <tr key={from.ip}>
                <td className="p-2 font-medium whitespace-nowrap text-sm">{from.name}</td>
                {servers.map((to) => {
                  if (from.ip === to.ip) {
                    return (
                      <td key={to.ip} className="p-2 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 bg-muted rounded text-muted-foreground text-[10px]">—</span>
                      </td>
                    )
                  }
                  const peer = matrix.get(from.ip)?.get(to.ip)
                  if (!peer) {
                    return (
                      <td key={to.ip} className="p-2 text-center">
                        <span
                          className="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-200 dark:bg-gray-700 cursor-default"
                          title={`${from.name} → ${to.name}\nNo data`}
                        />
                      </td>
                    )
                  }
                  const color = qualityColor(peer)
                  const label = qualityLabel(peer)
                  const rttText = peer.rtt_ms != null ? `${peer.rtt_ms}ms` : ''
                  const tooltip = [
                    `${from.name} → ${to.name}`,
                    `Status: ${peer.status}`,
                    `Quality: ${label}`,
                    rttText ? `RTT: ${rttText}` : '',
                  ].filter(Boolean).join('\n')
                  return (
                    <td key={to.ip} className="p-2 text-center">
                      <span
                        className={`inline-flex flex-col items-center justify-center w-8 h-8 rounded cursor-default ${color} text-white`}
                        title={tooltip}
                      >
                        {rttText && (
                          <span className="text-[9px] font-mono leading-none opacity-90">{rttText}</span>
                        )}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-green-500" />
          Excellent &lt;10ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-green-400" />
          Good &lt;50ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-yellow-500" />
          Fair &lt;200ms
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-red-500" />
          Poor / Failed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-gray-300 dark:bg-gray-600" />
          Pending
        </span>
      </div>
    </div>
  )
}
