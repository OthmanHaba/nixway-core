package agent

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

type ResourceData struct {
	CpuModel          string
	CpuCores          int32
	MemoryTotal       uint64
	MemoryAvailable   uint64
	KernelVersion     string
	DockerVersion     string
	Disks             []*agentv1.DiskInfo
	NetworkInterfaces []*agentv1.NetworkInterface
}

type ConnState struct {
	AgentID   string
	LastSeen  time.Time
	Status    string // "online", "degraded", "offline"
	Resources *ResourceData
	stream    agentv1.AgentService_ConnectServer // unexported, managed internally
}

type ConnManager struct {
	mu     sync.RWMutex
	agents map[string]*ConnState
	logger *slog.Logger
}

func NewConnManager(logger *slog.Logger) *ConnManager {
	return &ConnManager{agents: make(map[string]*ConnState), logger: logger}
}

func (m *ConnManager) Register(agentID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agents[agentID] = &ConnState{AgentID: agentID, LastSeen: time.Now(), Status: "online"}
	m.logger.Info("agent registered", "agent_id", agentID)
}

func (m *ConnManager) Heartbeat(agentID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if state, ok := m.agents[agentID]; ok {
		state.LastSeen = time.Now()
		state.Status = "online"
	}
}

func (m *ConnManager) Disconnect(agentID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.agents, agentID)
	m.logger.Info("agent disconnected", "agent_id", agentID)
}

func (m *ConnManager) GetState(agentID string) *ConnState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if state, ok := m.agents[agentID]; ok {
		copy := *state
		return &copy
	}
	return nil
}

func (m *ConnManager) ListOnline() []ConnState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]ConnState, 0, len(m.agents))
	for _, s := range m.agents {
		result = append(result, *s)
	}
	return result
}

func (m *ConnManager) UpdateResources(agentID string, report *agentv1.ResourceReport) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.agents[agentID]
	if !ok {
		return
	}
	state.Resources = &ResourceData{
		CpuModel:          report.GetCpuModel(),
		CpuCores:          report.GetCpuCores(),
		MemoryTotal:       report.GetMemoryTotal(),
		MemoryAvailable:   report.GetMemoryAvailable(),
		KernelVersion:     report.GetKernelVersion(),
		DockerVersion:     report.GetDockerVersion(),
		Disks:             report.GetDisks(),
		NetworkInterfaces: report.GetNetworkInterfaces(),
	}
}

// SetStream stores the bidirectional gRPC stream for a connected agent.
func (m *ConnManager) SetStream(agentID string, stream agentv1.AgentService_ConnectServer) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if state, ok := m.agents[agentID]; ok {
		state.stream = stream
	}
}

// SendToAgent sends a control message to a specific connected agent.
func (m *ConnManager) SendToAgent(agentID string, msg *agentv1.ControlMessage) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	state, ok := m.agents[agentID]
	if !ok {
		return fmt.Errorf("agent %s not connected", agentID)
	}
	if state.stream == nil {
		return fmt.Errorf("agent %s has no active stream", agentID)
	}
	return state.stream.Send(msg)
}
