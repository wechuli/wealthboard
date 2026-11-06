package ratelimit

import (
	"testing"
	"time"
)

func TestWindowLimitsEachKeyAndResets(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	limiter := New(1, time.Minute, func() time.Time { return now })
	if ok, _ := limiter.Allow("a"); !ok {
		t.Fatal("first request denied")
	}
	if ok, wait := limiter.Allow("a"); ok || wait != time.Minute {
		t.Fatalf("second request allowed=%v wait=%v", ok, wait)
	}
	if ok, _ := limiter.Allow("b"); !ok {
		t.Fatal("another key shared the limit")
	}
	now = now.Add(40 * time.Second)
	if ok, wait := limiter.Allow("a"); ok || wait != 20*time.Second {
		t.Fatalf("mid-window request allowed=%v wait=%v", ok, wait)
	}
	now = now.Add(20 * time.Second)
	if ok, _ := limiter.Allow("a"); !ok {
		t.Fatal("window did not reset")
	}
}
