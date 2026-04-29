package database

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// cronSchedule is a tiny cron evaluator that supports:
//   - the standard 5-field "min hour dom mon dow" form (with * and ranges)
//   - "@hourly", "@daily", "@weekly", "@monthly"
//   - "@every <duration>" (e.g. "@every 6h")
//
// The scheduler only needs an "is the next fire-time after lastRun and on or
// before now?" check, so we keep things simple and avoid pulling in a full
// cron library. Step values (e.g. "*/15") and named months/days are not
// supported in v1; users requesting those should pick "@every" instead.
type cronSchedule struct {
	// every is non-zero when the schedule is "@every <dur>" — that branch is
	// evaluated by computing lastRun + every and comparing to now.
	every time.Duration

	// For the 5-field form we record allowed values per field. nil means
	// "any value matches" (the cron "*" wildcard).
	min, hour, dom, mon, dow []int
}

// parseCronSchedule parses a cron expression into a cronSchedule.
func parseCronSchedule(expr string) (*cronSchedule, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, errors.New("empty cron expression")
	}
	if strings.HasPrefix(expr, "@every ") {
		dur, err := time.ParseDuration(strings.TrimPrefix(expr, "@every "))
		if err != nil {
			return nil, fmt.Errorf("invalid @every duration: %w", err)
		}
		if dur <= 0 {
			return nil, errors.New("@every duration must be positive")
		}
		return &cronSchedule{every: dur}, nil
	}
	switch expr {
	case "@hourly":
		return &cronSchedule{min: []int{0}}, nil
	case "@daily", "@midnight":
		return &cronSchedule{min: []int{0}, hour: []int{0}}, nil
	case "@weekly":
		return &cronSchedule{min: []int{0}, hour: []int{0}, dow: []int{0}}, nil
	case "@monthly":
		return &cronSchedule{min: []int{0}, hour: []int{0}, dom: []int{1}}, nil
	}

	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron expression must have 5 fields, got %d", len(fields))
	}
	min, err := parseCronField(fields[0], 0, 59)
	if err != nil {
		return nil, fmt.Errorf("minute: %w", err)
	}
	hour, err := parseCronField(fields[1], 0, 23)
	if err != nil {
		return nil, fmt.Errorf("hour: %w", err)
	}
	dom, err := parseCronField(fields[2], 1, 31)
	if err != nil {
		return nil, fmt.Errorf("day-of-month: %w", err)
	}
	mon, err := parseCronField(fields[3], 1, 12)
	if err != nil {
		return nil, fmt.Errorf("month: %w", err)
	}
	dow, err := parseCronField(fields[4], 0, 6)
	if err != nil {
		return nil, fmt.Errorf("day-of-week: %w", err)
	}
	return &cronSchedule{min: min, hour: hour, dom: dom, mon: mon, dow: dow}, nil
}

// parseCronField parses a single cron field (e.g. "0", "*", "1-5", "1,5,10").
// Returns nil for "*" — meaning "match any value in [lo, hi]".
func parseCronField(field string, lo, hi int) ([]int, error) {
	if field == "*" {
		return nil, nil
	}
	out := make(map[int]struct{})
	for _, part := range strings.Split(field, ",") {
		if strings.Contains(part, "-") {
			rng := strings.SplitN(part, "-", 2)
			if len(rng) != 2 {
				return nil, fmt.Errorf("invalid range %q", part)
			}
			a, err := strconv.Atoi(rng[0])
			if err != nil {
				return nil, fmt.Errorf("invalid range start %q", rng[0])
			}
			b, err := strconv.Atoi(rng[1])
			if err != nil {
				return nil, fmt.Errorf("invalid range end %q", rng[1])
			}
			if a < lo || b > hi || a > b {
				return nil, fmt.Errorf("range %d-%d outside [%d,%d]", a, b, lo, hi)
			}
			for v := a; v <= b; v++ {
				out[v] = struct{}{}
			}
		} else {
			v, err := strconv.Atoi(part)
			if err != nil {
				return nil, fmt.Errorf("invalid value %q", part)
			}
			if v < lo || v > hi {
				return nil, fmt.Errorf("value %d outside [%d,%d]", v, lo, hi)
			}
			out[v] = struct{}{}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no values matched")
	}
	values := make([]int, 0, len(out))
	for v := range out {
		values = append(values, v)
	}
	return values, nil
}

// shouldRun reports whether the schedule has fired since lastRun, given
// the current time `now`. lastRun.IsZero() means "no previous run", in which
// case any matching minute in the past 24h triggers (so a brand-new schedule
// fires on its next matching minute rather than waiting a full cycle).
func (c *cronSchedule) shouldRun(lastRun, now time.Time) bool {
	if c.every > 0 {
		if lastRun.IsZero() {
			return true
		}
		return now.Sub(lastRun) >= c.every
	}

	// Walk minute-by-minute from max(lastRun+1m, now-24h) to now, looking for
	// any matching minute. 24h is a safe upper bound: it bounds the worst-case
	// catch-up after a long outage AND every cron expression has at least one
	// fire-time per 24h (or it's "@monthly"/etc which we handle via shortcuts
	// already). The scheduler ticks every minute so the walk is at most 1
	// step in steady state.
	start := lastRun.Add(time.Minute).Truncate(time.Minute)
	earliest := now.Add(-24 * time.Hour).Truncate(time.Minute)
	if start.Before(earliest) {
		start = earliest
	}
	end := now.Truncate(time.Minute)
	for t := start; !t.After(end); t = t.Add(time.Minute) {
		if c.matches(t) {
			return true
		}
	}
	return false
}

func (c *cronSchedule) matches(t time.Time) bool {
	if !cronFieldMatches(c.min, t.Minute()) {
		return false
	}
	if !cronFieldMatches(c.hour, t.Hour()) {
		return false
	}
	if !cronFieldMatches(c.dom, t.Day()) {
		return false
	}
	if !cronFieldMatches(c.mon, int(t.Month())) {
		return false
	}
	// Sunday is 0 in Go's Weekday, matching cron convention.
	if !cronFieldMatches(c.dow, int(t.Weekday())) {
		return false
	}
	return true
}

func cronFieldMatches(allowed []int, v int) bool {
	if allowed == nil {
		return true
	}
	for _, a := range allowed {
		if a == v {
			return true
		}
	}
	return false
}
