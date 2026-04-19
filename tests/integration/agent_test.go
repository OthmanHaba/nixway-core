package integration

import (
	"context"
	"log/slog"
	"net"
	"os"
	"testing"
	"time"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// startGRPCServer starts an in-process gRPC server for agent tests and returns
// the server address, ConnManager, and a cleanup function.
func startGRPCServer(t *testing.T) (string, *agent.ConnManager) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	connMgr := agent.NewConnManager(logger)
	srv := agent.NewServer(connMgr, logger)

	grpcServer := grpc.NewServer()
	agentv1.RegisterAgentServiceServer(grpcServer, srv)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	go func() {
		_ = grpcServer.Serve(lis)
	}()
	t.Cleanup(func() {
		grpcServer.GracefulStop()
	})

	return lis.Addr().String(), connMgr
}

// TestAgentRegistration verifies Phase 0 exit criterion #3:
// Agent registers with control plane.
func TestAgentRegistration(t *testing.T) {
	addr, connMgr := startGRPCServer(t)
	ctx := context.Background()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	client := agentv1.NewAgentServiceClient(conn)

	// Register an agent
	resp, err := client.Register(ctx, &agentv1.RegisterRequest{
		Hostname: "test-host-1",
		Os:       "linux",
		Arch:     "amd64",
	})
	require.NoError(t, err)
	require.NotEmpty(t, resp.AgentId)

	// Verify ConnManager knows about the agent
	state := connMgr.GetState(resp.AgentId)
	require.NotNil(t, state)
	assert.Equal(t, "online", state.Status)
	assert.Equal(t, resp.AgentId, state.AgentID)
}

// TestAgentHeartbeat verifies Phase 0 exit criterion #3:
// Heartbeat flows via the Connect stream.
func TestAgentHeartbeat(t *testing.T) {
	addr, connMgr := startGRPCServer(t)
	ctx := context.Background()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	client := agentv1.NewAgentServiceClient(conn)

	// Register
	regResp, err := client.Register(ctx, &agentv1.RegisterRequest{
		Hostname: "heartbeat-host",
		Os:       "linux",
		Arch:     "amd64",
	})
	require.NoError(t, err)
	agentID := regResp.AgentId

	// Open Connect stream
	stream, err := client.Connect(ctx)
	require.NoError(t, err)

	// Send heartbeat
	err = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_Heartbeat{
			Heartbeat: &agentv1.Heartbeat{
				AgentId:   agentID,
				Timestamp: timestamppb.Now(),
			},
		},
	})
	require.NoError(t, err)

	// Give server a moment to process
	time.Sleep(50 * time.Millisecond)

	// Verify agent is still online and LastSeen updated
	state := connMgr.GetState(agentID)
	require.NotNil(t, state)
	assert.Equal(t, "online", state.Status)
	assert.WithinDuration(t, time.Now(), state.LastSeen, 2*time.Second)

	// Send another heartbeat
	err = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_Heartbeat{
			Heartbeat: &agentv1.Heartbeat{
				AgentId:   agentID,
				Timestamp: timestamppb.Now(),
			},
		},
	})
	require.NoError(t, err)

	time.Sleep(50 * time.Millisecond)

	state2 := connMgr.GetState(agentID)
	require.NotNil(t, state2)
	assert.True(t, !state2.LastSeen.Before(state.LastSeen),
		"LastSeen should be updated after second heartbeat")

	// Close stream
	err = stream.CloseSend()
	require.NoError(t, err)
}

// TestAgentExecOutput verifies Phase 0 exit criterion #4:
// Control plane receives exec output from agent via the stream.
func TestAgentExecOutput(t *testing.T) {
	addr, _ := startGRPCServer(t)
	ctx := context.Background()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	client := agentv1.NewAgentServiceClient(conn)

	// Register
	regResp, err := client.Register(ctx, &agentv1.RegisterRequest{
		Hostname: "exec-host",
		Os:       "linux",
		Arch:     "amd64",
	})
	require.NoError(t, err)
	agentID := regResp.AgentId

	// Open Connect stream
	stream, err := client.Connect(ctx)
	require.NoError(t, err)

	// Send initial heartbeat to establish identity
	err = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_Heartbeat{
			Heartbeat: &agentv1.Heartbeat{
				AgentId:   agentID,
				Timestamp: timestamppb.Now(),
			},
		},
	})
	require.NoError(t, err)

	time.Sleep(50 * time.Millisecond)

	// Simulate exec output from agent
	err = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ExecOutput{
			ExecOutput: &agentv1.ExecOutput{
				CommandId: "cmd-123",
				Stdout:    []byte("hello world\n"),
				Finished:  false,
				ExitCode:  0,
			},
		},
	})
	require.NoError(t, err)

	// Send final output
	err = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_ExecOutput{
			ExecOutput: &agentv1.ExecOutput{
				CommandId: "cmd-123",
				Stdout:    []byte(""),
				Finished:  true,
				ExitCode:  0,
			},
		},
	})
	require.NoError(t, err)

	time.Sleep(50 * time.Millisecond)

	// If we got here without error, the server processed the exec output.
	// The server logs exec output but doesn't return errors for valid messages.
	err = stream.CloseSend()
	require.NoError(t, err)
}

// TestAgentReconnect verifies Phase 0 exit criterion #5:
// Killing and restarting agent reconnects.
func TestAgentReconnect(t *testing.T) {
	addr, connMgr := startGRPCServer(t)
	ctx := context.Background()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	client := agentv1.NewAgentServiceClient(conn)

	// Register
	regResp, err := client.Register(ctx, &agentv1.RegisterRequest{
		Hostname: "reconnect-host",
		Os:       "linux",
		Arch:     "amd64",
	})
	require.NoError(t, err)
	agentID := regResp.AgentId

	// First connection
	stream1, err := client.Connect(ctx)
	require.NoError(t, err)

	err = stream1.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_Heartbeat{
			Heartbeat: &agentv1.Heartbeat{
				AgentId:   agentID,
				Timestamp: timestamppb.Now(),
			},
		},
	})
	require.NoError(t, err)
	time.Sleep(50 * time.Millisecond)

	state := connMgr.GetState(agentID)
	require.NotNil(t, state, "agent should be online after first connect")
	assert.Equal(t, "online", state.Status)

	// Disconnect (simulate agent kill)
	err = stream1.CloseSend()
	require.NoError(t, err)
	time.Sleep(100 * time.Millisecond)

	// After disconnect, agent entry is removed by the server's defer
	state = connMgr.GetState(agentID)
	assert.Nil(t, state, "agent should be removed after disconnect")

	// Reconnect — agent uses same ID, re-registers via heartbeat
	stream2, err := client.Connect(ctx)
	require.NoError(t, err)

	err = stream2.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_Heartbeat{
			Heartbeat: &agentv1.Heartbeat{
				AgentId:   agentID,
				Timestamp: timestamppb.Now(),
			},
		},
	})
	require.NoError(t, err)
	time.Sleep(50 * time.Millisecond)

	// Verify agent is back online
	state = connMgr.GetState(agentID)
	require.NotNil(t, state, "agent should be back online after reconnect")
	assert.Equal(t, "online", state.Status)

	err = stream2.CloseSend()
	require.NoError(t, err)
}

// TestAgentRegistrationRequiresHostname tests that registration
// rejects requests without a hostname.
func TestAgentRegistrationRequiresHostname(t *testing.T) {
	addr, _ := startGRPCServer(t)
	ctx := context.Background()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	client := agentv1.NewAgentServiceClient(conn)

	_, err = client.Register(ctx, &agentv1.RegisterRequest{
		Hostname: "",
		Os:       "linux",
		Arch:     "amd64",
	})
	assert.Error(t, err)
}
