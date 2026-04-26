package observability

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNextAlertState(t *testing.T) {
	now := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)
	duration := 5 * time.Minute

	tests := []struct {
		name      string
		current   string
		changedAt pgtype.Timestamptz
		breached  bool
		want      string
	}{
		{name: "ok breach enters pending", current: StateOK, breached: true, want: StatePending},
		{name: "pending before duration stays pending", current: StatePending, changedAt: pgtype.Timestamptz{Time: now.Add(-4 * time.Minute), Valid: true}, breached: true, want: StatePending},
		{name: "pending after duration fires", current: StatePending, changedAt: pgtype.Timestamptz{Time: now.Add(-5 * time.Minute), Valid: true}, breached: true, want: StateFiring},
		{name: "firing clear resolves", current: StateFiring, breached: false, want: StateResolved},
		{name: "pending clear resolves", current: StatePending, breached: false, want: StateResolved},
		{name: "ok clear remains ok", current: StateOK, breached: false, want: StateOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nextAlertState(tt.current, tt.changedAt, tt.breached, duration, now)
			if got != tt.want {
				t.Fatalf("nextAlertState() = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestCompare(t *testing.T) {
	if !compare(91, 90, "gt") {
		t.Fatal("gt comparison should breach")
	}
	if !compare(90, 90, "gte") {
		t.Fatal("gte comparison should breach")
	}
	if compare(89, 90, "gt") {
		t.Fatal("gt comparison should not breach")
	}
}
