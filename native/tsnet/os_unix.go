//go:build unix

package main

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func reserveStdout() (*os.File, error) {
	fd, err := syscall.Dup(1)
	if err != nil {
		return nil, fmt.Errorf("dup stdout: %w", err)
	}
	syscall.CloseOnExec(fd)
	// unix.Dup2: syscall.Dup2 does not exist on linux/arm64 (only dup3)
	if err := unix.Dup2(2, 1); err != nil {
		return nil, fmt.Errorf("redirect stdout: %w", err)
	}
	return os.NewFile(uintptr(fd), "status"), nil
}

func shutdownSignals() []os.Signal {
	return []os.Signal{syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP}
}
