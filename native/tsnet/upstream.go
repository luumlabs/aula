package main

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The local Aula server listens on a fixed loopback port. If it dies and
// another local process binds that port before Aula is back, a plain proxy
// would hand that process the proxy key and the phone's device token on the
// next request. newVerifyingTransport checks every new connection first:
// GET /health?challenge=<nonce> must come back with
// proof.proxy = base64url(HMAC-SHA256(proxyKey, "aula-health:v1:"+nonce)),
// which only the real server (it got the same key over IPC) can compute. The
// challenge itself carries nothing secret. A connection that fails is closed
// and the phone gets a 502, which it retries calmly.

// errNotAula: whatever listens on the target port is not this Aula server.
var errNotAula = errors.New("the local server did not prove it is Aula")

// healthProof is the server's answer to a challenge (server/src/api/auth.ts healthProof).
func healthProof(key, nonce string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte("aula-health:v1:" + nonce))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func newNonce() string {
	b := make([]byte, 24)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// proveServer runs the challenge on a fresh connection c to host and leaves
// the connection ready for the proxied request (the answer read to its end).
func proveServer(ctx context.Context, c net.Conn, host, proxyKey string) error {
	deadline := time.Now().Add(5 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	c.SetDeadline(deadline)
	defer c.SetDeadline(time.Time{})
	nonce := newNonce()
	if _, err := fmt.Fprintf(c, "GET /health?challenge=%s HTTP/1.1\r\nHost: %s\r\nAccept: application/json\r\n\r\n", nonce, host); err != nil {
		return err
	}
	br := bufio.NewReader(c)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		return err
	}
	var body struct {
		Proof struct {
			Proxy string `json:"proxy"`
		} `json:"proof"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body)
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK || resp.Close {
		return errNotAula
	}
	if br.Buffered() > 0 {
		return errNotAula // more than one answer: not a well-behaved server
	}
	if !hmac.Equal([]byte(body.Proof.Proxy), []byte(healthProof(proxyKey, nonce))) {
		return errNotAula
	}
	return nil
}

// newVerifyingTransport is the proxy's transport to the local server: every
// connection it opens has proved, before anything else is sent on it, that
// the server at the other end holds the proxy key.
func newVerifyingTransport(target *url.URL, proxyKey string, logf func(string, ...any)) *http.Transport {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	tr.ForceAttemptHTTP2 = false
	tr.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := d.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		if err := proveServer(ctx, c, target.Host, proxyKey); err != nil {
			c.Close()
			logf("refusing to forward to %s: %v", addr, err)
			return nil, err
		}
		return c, nil
	}
	return tr
}

// rotatingFile is aula-tsnet's own log on disk: the Mac app ignores its
// stderr, and without it "the iPhone can't reach the Mac" cannot be told
// apart from a damaged node or an expired key. Two files at most: the log
// and the previous one (.1), each up to max bytes.
type rotatingFile struct {
	mu   sync.Mutex
	path string
	max  int64
	f    *os.File
	size int64
}

func openRotating(path string, max int64) (*rotatingFile, error) {
	r := &rotatingFile{path: path, max: max}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *rotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.size = f, st.Size()
	return nil
}

func (r *rotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return len(p), nil
	}
	if r.size+int64(len(p)) > r.max {
		r.f.Close()
		os.Rename(r.path, r.path+".1")
		if err := r.open(); err != nil {
			r.f = nil
			return len(p), nil
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *rotatingFile) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return nil
	}
	err := r.f.Close()
	r.f = nil
	return err
}

// logPath is where aula-tsnet writes its log: $AULA_TSNET_LOG, else the Mac
// app's logs folder next to the state dir (<data>/logs/tailnet.log, which
// «Mostrar los registros de Aula» opens), else inside the state dir.
func logPath(stateDir string, getenv func(string) string) string {
	if p := getenv("AULA_TSNET_LOG"); p != "" {
		return p
	}
	logs := filepath.Join(filepath.Dir(stateDir), "logs")
	if st, err := os.Stat(logs); err == nil && st.IsDir() {
		return filepath.Join(logs, "tailnet.log")
	}
	return filepath.Join(stateDir, "aula-tsnet.log")
}
