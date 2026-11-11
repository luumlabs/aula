// Added to libtailscale (package main of the c-archive) by
// native/ios/build-tailscalekit.sh before it builds TailscaleKit.framework.
//
// Aula is private by design: the embedded node of the iPhone or iPad must not upload its
// logs (node names, tailnet and public IPs, connection events) to
// log.tailscale.com, exactly like the Mac's aula-tsnet (native/tsnet/main.go,
// disableLogUploads). It has to happen inside the Go runtime: in a c-archive
// Go reads the environment once at load, so the app cannot set
// TS_NO_LOGS_NO_SUPPORT for it later, and libtailscale exports no switch.
//
// The envknob marks the node "no logs, no support" (logpolicy's transport then
// never uploads); tsnet runs its own logtail uploader, which only the
// process-wide logtail.Disable stops.

package main

import (
	"tailscale.com/envknob"
	"tailscale.com/logtail"
)

func init() {
	envknob.SetNoLogsNoSupport()
	logtail.Disable()
}
