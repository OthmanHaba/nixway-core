package scheduler

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

const (
	StrategySpread  = "spread"
	StrategyBinpack = "binpack"
	StrategyPinned  = "pinned"
)

type Constraints struct {
	MustHave    map[string]string `json:"must_have"`
	MustNotHave map[string]string `json:"must_not_have"`
}

type Candidate struct {
	ServerID        uuid.UUID
	ServerName      string
	Status          string
	Tags            map[string]string
	RunningReplicas int32
	CPUCapacity     int32
	MemoryAvailable int64
	HasCPUData      bool
	HasMemoryData   bool
}

type Requirements struct {
	Replicas           int32
	Strategy           string
	PinnedServerIDs    []uuid.UUID
	Constraints        Constraints
	MemoryLimitMB      int32
	CPULimitMillicores int32
}

type Assignment struct {
	ServerID   uuid.UUID `json:"server_id"`
	ServerName string    `json:"server_name"`
	Replicas   int32     `json:"replicas"`
	Reason     string    `json:"reason"`
}

func ParseConstraints(raw []byte) Constraints {
	if len(raw) == 0 {
		return Constraints{}
	}
	var constraints Constraints
	if err := json.Unmarshal(raw, &constraints); err != nil {
		return Constraints{}
	}
	if constraints.MustHave == nil {
		constraints.MustHave = map[string]string{}
	}
	if constraints.MustNotHave == nil {
		constraints.MustNotHave = map[string]string{}
	}
	return constraints
}

func EncodeConstraints(constraints Constraints) []byte {
	if constraints.MustHave == nil {
		constraints.MustHave = map[string]string{}
	}
	if constraints.MustNotHave == nil {
		constraints.MustNotHave = map[string]string{}
	}
	raw, err := json.Marshal(constraints)
	if err != nil {
		return []byte(`{"must_have":{},"must_not_have":{}}`)
	}
	return raw
}

func Schedule(req Requirements, candidates []Candidate) ([]Assignment, error) {
	if req.Replicas <= 0 {
		return nil, fmt.Errorf("replicas must be greater than zero")
	}
	if req.Strategy == "" {
		req.Strategy = StrategySpread
	}

	eligible := make([]Candidate, 0, len(candidates))
	pinned := pinnedSet(req.PinnedServerIDs)
	for _, candidate := range candidates {
		if candidate.Status != "online" {
			continue
		}
		if req.Strategy == StrategyPinned && !pinned[candidate.ServerID] {
			continue
		}
		if !matchesConstraints(candidate.Tags, req.Constraints) {
			continue
		}
		if req.MemoryLimitMB > 0 && candidate.HasMemoryData && candidate.MemoryAvailable < int64(req.MemoryLimitMB)*1024*1024 {
			continue
		}
		if req.CPULimitMillicores > 0 && candidate.HasCPUData && candidate.CPUCapacity < req.CPULimitMillicores {
			continue
		}
		eligible = append(eligible, candidate)
	}

	if len(eligible) == 0 {
		return nil, fmt.Errorf("no eligible servers match placement strategy %q and constraints", req.Strategy)
	}
	if int(req.Replicas) > len(eligible) {
		return nil, fmt.Errorf("insufficient eligible servers: need %d, have %d", req.Replicas, len(eligible))
	}

	switch req.Strategy {
	case StrategySpread:
		sort.SliceStable(eligible, func(i, j int) bool {
			if eligible[i].RunningReplicas == eligible[j].RunningReplicas {
				return eligible[i].ServerName < eligible[j].ServerName
			}
			return eligible[i].RunningReplicas < eligible[j].RunningReplicas
		})
	case StrategyBinpack:
		sort.SliceStable(eligible, func(i, j int) bool {
			if eligible[i].RunningReplicas == eligible[j].RunningReplicas {
				return eligible[i].ServerName < eligible[j].ServerName
			}
			return eligible[i].RunningReplicas > eligible[j].RunningReplicas
		})
	case StrategyPinned:
		order := map[uuid.UUID]int{}
		for i, id := range req.PinnedServerIDs {
			order[id] = i
		}
		sort.SliceStable(eligible, func(i, j int) bool {
			return order[eligible[i].ServerID] < order[eligible[j].ServerID]
		})
	default:
		return nil, fmt.Errorf("unknown placement strategy %q", req.Strategy)
	}

	assignments := make([]Assignment, 0, req.Replicas)
	for i := 0; i < int(req.Replicas); i++ {
		candidate := eligible[i]
		assignments = append(assignments, Assignment{
			ServerID:   candidate.ServerID,
			ServerName: candidate.ServerName,
			Replicas:   1,
			Reason:     reasonFor(req.Strategy, candidate),
		})
	}
	return assignments, nil
}

func pinnedSet(ids []uuid.UUID) map[uuid.UUID]bool {
	set := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set
}

func matchesConstraints(tags map[string]string, constraints Constraints) bool {
	for key, value := range constraints.MustHave {
		if tags[key] != value {
			return false
		}
	}
	for key, value := range constraints.MustNotHave {
		if tags[key] == value {
			return false
		}
	}
	return true
}

func reasonFor(strategy string, candidate Candidate) string {
	switch strategy {
	case StrategyBinpack:
		return fmt.Sprintf("binpack selected %s with %d running replicas", candidate.ServerName, candidate.RunningReplicas)
	case StrategyPinned:
		return fmt.Sprintf("pinned placement selected %s", candidate.ServerName)
	default:
		return fmt.Sprintf("spread selected %s with %d running replicas", candidate.ServerName, candidate.RunningReplicas)
	}
}
