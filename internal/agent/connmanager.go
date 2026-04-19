package agent

import (
	"log/slog"
	"sync"
	"time"
)

type ConnState struct {
	AgentID  string
	LastSeen time.Time
	Status   string // "online", "degraded", "offline"
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
