//go:build linux

package main

// Tailscale's support for running as an Android app's process (interfaces,
// DNS, certificates). Inert on an ordinary Linux; the package only exists on
// Linux, so the tests also build on a Mac.
import _ "tailscale.com/feature/androidbin"
