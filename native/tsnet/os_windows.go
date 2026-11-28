//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

// reserveStdout duplicates the real stdout handle (non-inheritable) for the
// newline-delimited JSON status protocol and points both STD_OUTPUT_HANDLE and
// os.Stdout at stderr so stray writes from dependencies never corrupt stdout.
func reserveStdout() (*os.File, error) {
	origStdout := os.Stdout
	origFd := origStdout.Fd()
	stderrFd := os.Stderr.Fd()
	proc := windows.CurrentProcess()
	var dup windows.Handle
	if err := windows.DuplicateHandle(proc, windows.Handle(origFd), proc, &dup, 0, false, windows.DUPLICATE_SAME_ACCESS); err != nil {
		return nil, fmt.Errorf("dup stdout: %w", err)
	}
	if err := windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, windows.Handle(stderrFd)); err != nil {
		windows.CloseHandle(dup)
		return nil, fmt.Errorf("redirect stdout: %w", err)
	}
	os.Stdout = os.Stderr
	if origFd != stderrFd {
		_ = origStdout.Close()
	}
	return os.NewFile(uintptr(dup), "status"), nil
}

func shutdownSignals() []os.Signal {
	return []os.Signal{os.Interrupt, syscall.SIGTERM}
}
