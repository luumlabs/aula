package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestReserveStdoutSeparatesStatusFromStrayPrints(t *testing.T) {
	if os.Getenv("AULA_TEST_RESERVE_STDOUT") == "1" {
		statusOut, err := reserveStdout()
		if err != nil {
			fmt.Fprintf(os.Stderr, "reserveStdout error: %v\n", err)
			os.Exit(2)
		}
		// Stray stdout writes must land on stderr and never corrupt statusOut.
		fmt.Println("stray-stdout-noise")
		em := &Emitter{w: statusOut}
		em.Emit(Event{Type: "starting"})
		_ = statusOut.Close()
		os.Exit(0)
	}

	cmd := exec.Command(os.Args[0], "-test.run=^TestReserveStdoutSeparatesStatusFromStrayPrints$")
	cmd.Env = append(os.Environ(), "AULA_TEST_RESERVE_STDOUT=1")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("subprocess failed: %v\nstdout=%q\nstderr=%q", err, stdout.String(), stderr.String())
	}

	gotOut := strings.TrimSpace(stdout.String())
	var ev Event
	if err := json.Unmarshal([]byte(gotOut), &ev); err != nil {
		t.Fatalf("stdout was not clean status JSON: %v (stdout=%q, stderr=%q)", err, stdout.String(), stderr.String())
	}
	if ev.Type != "starting" {
		t.Fatalf("event type = %q, want starting", ev.Type)
	}
	if strings.Contains(stdout.String(), "stray-stdout-noise") {
		t.Fatalf("stray stdout leaked onto status pipe: %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "stray-stdout-noise") {
		t.Fatalf("stray stdout did not redirect to stderr: %q", stderr.String())
	}
}
