package mesh

import (
	"log/slog"
	"os"
	"sync"
	"testing"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockSender records all control messages sent to agents.
type mockSender struct {
	mu       sync.Mutex
	messages map[string][]*agentv1.ControlMessage
}

func newMockSender() *mockSender {
	return &mockSender{messages: make(map[string][]*agentv1.ControlMessage)}
}

func (m *mockSender) SendToAgent(agentID string, msg *agentv1.ControlMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages[agentID] = append(m.messages[agentID], msg)
	return nil
}

func (m *mockSender) getMessages(agentID string) []*agentv1.ControlMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.messages[agentID]
}

func (m *mockSender) allAgentIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var ids []string
	for id := range m.messages {
		ids = append(ids, id)
	}
	return ids
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestNewManager(t *testing.T) {
	sender := newMockSender()
	mgr := NewManager(nil, sender, nil, testLogger())
	assert.NotNil(t, mgr)
}

func TestManager_RequestKeyGen(t *testing.T) {
	sender := newMockSender()
	mgr := NewManager(nil, sender, nil, testLogger())

	mgr.RequestKeyGen("agent-1", "member-abc", 51820)

	msgs := sender.getMessages("agent-1")
	require.Len(t, msgs, 1)

	keygen := msgs[0].GetWireguardKeygen()
	require.NotNil(t, keygen)
	assert.Equal(t, "member-abc", keygen.MemberId)
	assert.Equal(t, int32(51820), keygen.ListenPort)
}

func TestManager_sendKeyGenCommand(t *testing.T) {
	sender := newMockSender()
	mgr := NewManager(nil, sender, nil, testLogger())

	mgr.sendKeyGenCommand("agent-x", "member-99", 51821)

	msgs := sender.getMessages("agent-x")
	require.Len(t, msgs, 1)

	keygen := msgs[0].GetWireguardKeygen()
	require.NotNil(t, keygen)
	assert.Equal(t, "member-99", keygen.MemberId)
	assert.Equal(t, int32(51821), keygen.ListenPort)
}

func TestManager_MultipleKeyGenCommands(t *testing.T) {
	sender := newMockSender()
	mgr := NewManager(nil, sender, nil, testLogger())

	mgr.RequestKeyGen("agent-a", "m1", 51820)
	mgr.RequestKeyGen("agent-b", "m2", 51820)
	mgr.RequestKeyGen("agent-a", "m3", 51820)

	assert.Len(t, sender.getMessages("agent-a"), 2, "agent-a should have 2 keygen commands")
	assert.Len(t, sender.getMessages("agent-b"), 1, "agent-b should have 1 keygen command")
}

func TestGenerateConfig_NoMembers(t *testing.T) {
	self := MemberInfo{
		WireGuardIP: "10.100.0.1",
		PublicKey:   "key1",
		Endpoint:    "1.2.3.4:51820",
		ListenPort:  51820,
	}
	cfg, err := GenerateConfig(self, nil)
	require.NoError(t, err)
	assert.Contains(t, cfg, "Address = 10.100.0.1/32")
	assert.NotContains(t, cfg, "[Peer]")
}

func TestGenerateConfig_PrivateKeyPlaceholder(t *testing.T) {
	self := MemberInfo{
		WireGuardIP: "10.100.0.1",
		PublicKey:   "key1",
		Endpoint:    "1.2.3.4:51820",
		ListenPort:  51820,
	}
	cfg, err := GenerateConfig(self, []MemberInfo{self})
	require.NoError(t, err)
	assert.Contains(t, cfg, "PRIVATE_KEY_PLACEHOLDER")
}

func TestGenerateConfig_FourNodes_FullMesh(t *testing.T) {
	members := []MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "k1", Endpoint: "1.1.1.1:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.2", PublicKey: "k2", Endpoint: "2.2.2.2:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.3", PublicKey: "k3", Endpoint: "3.3.3.3:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.4", PublicKey: "k4", Endpoint: "4.4.4.4:51820", ListenPort: 51820},
	}

	for i, self := range members {
		cfg, err := GenerateConfig(self, members)
		require.NoError(t, err, "node %d", i)

		// Should have 3 peers (all except self)
		peerCount := 0
		for _, line := range splitLines(cfg) {
			if line == "[Peer]" {
				peerCount++
			}
		}
		assert.Equal(t, 3, peerCount, "node %d should have 3 peers", i)

		// Should not contain own key
		assert.NotContains(t, cfg, "PublicKey = "+self.PublicKey+"peer should not include self")
	}
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
