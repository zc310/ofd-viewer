package main

import "testing"

func TestAllowedWebSocketOriginWailsStable(t *testing.T) {
	if !allowedWebSocketOrigin("wails://localhost") {
		t.Fatal("Wails v3.0.0 asset origin wails://localhost should be allowed")
	}
}
