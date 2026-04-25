package scheduler

import (
	"testing"

	"github.com/google/uuid"
)

func TestScheduleSpreadUsesLeastLoadedServers(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()

	assignments, err := Schedule(Requirements{
		Replicas: 2,
		Strategy: StrategySpread,
	}, []Candidate{
		{ServerID: a, ServerName: "a", Status: "online", RunningReplicas: 4},
		{ServerID: b, ServerName: "b", Status: "online", RunningReplicas: 1},
		{ServerID: c, ServerName: "c", Status: "online", RunningReplicas: 0},
	})
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	if assignments[0].ServerID != c || assignments[1].ServerID != b {
		t.Fatalf("expected least loaded servers c,b; got %#v", assignments)
	}
}

func TestSchedulePinnedAndConstraints(t *testing.T) {
	a := uuid.New()
	b := uuid.New()

	assignments, err := Schedule(Requirements{
		Replicas:        1,
		Strategy:        StrategyPinned,
		PinnedServerIDs: []uuid.UUID{a, b},
		Constraints: Constraints{
			MustHave: map[string]string{"gpu": "true"},
		},
	}, []Candidate{
		{ServerID: a, ServerName: "a", Status: "online", Tags: map[string]string{"gpu": "false"}},
		{ServerID: b, ServerName: "b", Status: "online", Tags: map[string]string{"gpu": "true"}},
	})
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	if assignments[0].ServerID != b {
		t.Fatalf("expected constrained pinned server b; got %#v", assignments)
	}
}

func TestScheduleRefusesInsufficientEligibleServers(t *testing.T) {
	_, err := Schedule(Requirements{
		Replicas: 2,
		Strategy: StrategySpread,
	}, []Candidate{
		{ServerID: uuid.New(), ServerName: "a", Status: "online"},
		{ServerID: uuid.New(), ServerName: "b", Status: "offline"},
	})
	if err == nil {
		t.Fatal("expected insufficient eligible servers error")
	}
}
