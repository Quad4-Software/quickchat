// SPDX-License-Identifier: 0BSD
package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

func TestBurstThenDeny(t *testing.T) {
	l := New(60, 3)
	for i := range 3 {
		if !l.Allow("ip") {
			t.Fatalf("request %d within burst should be allowed", i)
		}
	}
	if l.Allow("ip") {
		t.Fatal("request beyond burst should be denied")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := New(60, 1)
	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("first request per key should pass")
	}
	if l.Allow("a") || l.Allow("b") {
		t.Fatal("second request per key should be denied")
	}
}

func TestRefill(t *testing.T) {
	l := New(600, 1) // 10 per second
	if !l.Allow("ip") || l.Allow("ip") {
		t.Fatal("burst of 1 should allow once then deny")
	}
	// simulate elapsed time by backdating the bucket
	l.mu.Lock()
	l.buckets["ip"].last = time.Now().Add(-time.Second)
	l.mu.Unlock()
	if !l.Allow("ip") {
		t.Fatal("bucket should have refilled")
	}
}

func TestConcurrent(t *testing.T) {
	l := New(60000, 1000)
	done := make(chan struct{})
	for i := range 16 {
		go func(i int) {
			defer func() { done <- struct{}{} }()
			key := fmt.Sprintf("ip-%d", i%4)
			for range 100 {
				l.Allow(key)
			}
		}(i)
	}
	for range 16 {
		<-done
	}
}
