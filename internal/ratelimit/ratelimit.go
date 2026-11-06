// Package ratelimit counts requests per key in fixed windows held in memory.
// Counts are per process, so each replica applies its own limit.
package ratelimit

import (
	"sync"
	"time"
)

const pruneThreshold = 10_000

type Window struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	now     func() time.Time
	windows map[string]bucket
}

type bucket struct {
	start time.Time
	count int
}

func New(limit int, window time.Duration, now func() time.Time) *Window {
	if now == nil {
		now = time.Now
	}
	return &Window{limit: limit, window: window, now: now, windows: map[string]bucket{}}
}

// Allow counts one request for key and, when the limit is reached, reports how
// long until the key's window resets.
func (limiter *Window) Allow(key string) (bool, time.Duration) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := limiter.now()
	if len(limiter.windows) > pruneThreshold {
		for stale, current := range limiter.windows {
			if now.Sub(current.start) >= limiter.window {
				delete(limiter.windows, stale)
			}
		}
	}
	current := limiter.windows[key]
	if now.Sub(current.start) >= limiter.window {
		current = bucket{start: now}
	}
	if current.count >= limiter.limit {
		return false, current.start.Add(limiter.window).Sub(now)
	}
	current.count++
	limiter.windows[key] = current
	return true, 0
}
