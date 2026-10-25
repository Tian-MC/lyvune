package cmd

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("healthcheck", func() {
	var ctx context.Context

	BeforeEach(func() {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		DeferCleanup(cancel)
	})

	serve := func(status int) healthTarget {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/ping" {
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte("."))
		}))
		DeferCleanup(srv.Close)
		u, _ := url.Parse(srv.URL)
		port, _ := strconv.Atoi(u.Port())
		return healthTarget{address: u.Hostname(), port: port}
	}

	It("is healthy when the server answers /ping", func() {
		Expect(checkHealth(ctx, serve(http.StatusOK))).To(Succeed())
	})

	It("reaches a server bound to all interfaces through the loopback address", func() {
		t := serve(http.StatusOK)
		t.address = "0.0.0.0"
		Expect(checkHealth(ctx, t)).To(Succeed())
		t.address = ""
		Expect(checkHealth(ctx, t)).To(Succeed())
	})

	It("is unhealthy when the server answers with an error", func() {
		err := checkHealth(ctx, serve(http.StatusInternalServerError))
		Expect(err).To(MatchError(ContainSubstring("500")))
	})

	It("is unhealthy when nothing is listening", func() {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		Expect(err).ToNot(HaveOccurred())
		port := l.Addr().(*net.TCPAddr).Port
		Expect(l.Close()).To(Succeed())
		Expect(checkHealth(ctx, healthTarget{address: "127.0.0.1", port: port})).To(HaveOccurred())
	})

	It("is unhealthy when the server accepts the connection and never answers", func() {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		Expect(err).ToNot(HaveOccurred())
		DeferCleanup(func() { _ = l.Close() })
		go func() {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				DeferCleanup(func() { _ = c.Close() })
			}
		}()
		short, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
		defer cancel()
		port := l.Addr().(*net.TCPAddr).Port
		Expect(checkHealth(short, healthTarget{address: "127.0.0.1", port: port})).To(HaveOccurred())
	})

	It("reaches a server on a unix socket", func() {
		sock := filepath.Join(GinkgoT().TempDir(), "lyvune.sock")
		l, err := net.Listen("unix", sock)
		Expect(err).ToNot(HaveOccurred())
		srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/ping" {
				_, _ = w.Write([]byte("."))
			}
		}), ReadHeaderTimeout: time.Second}
		go func() { _ = srv.Serve(l) }()
		DeferCleanup(func() { _ = srv.Close(); _ = os.Remove(sock) })

		Expect(checkHealth(ctx, healthTarget{address: "unix:" + sock})).To(Succeed())
	})

	It("reaches a server that uses TLS, whatever its certificate says", func() {
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("."))
		}))
		DeferCleanup(srv.Close)
		u, _ := url.Parse(srv.URL)
		port, _ := strconv.Atoi(u.Port())
		Expect(checkHealth(ctx, healthTarget{address: u.Hostname(), port: port, tls: true})).To(Succeed())
		// speaking plain HTTP to it is not healthy
		Expect(checkHealth(ctx, healthTarget{address: u.Hostname(), port: port})).To(HaveOccurred())
	})

	It("builds the URL from the address and port", func() {
		cases := map[healthTarget]string{
			{address: "", port: 4533}:               "http://127.0.0.1:4533/ping",
			{address: "0.0.0.0", port: 4533}:        "http://127.0.0.1:4533/ping",
			{address: "::", port: 4533}:             "http://[::1]:4533/ping",
			{address: "192.168.1.5", port: 8080}:    "http://192.168.1.5:8080/ping",
			{address: "::1", port: 4533, tls: true}: "https://[::1]:4533/ping",
			{address: "unix:/run/lyvune.sock"}:      "http://unix/ping",
		}
		for target, want := range cases {
			_, got := target.client()
			Expect(got).To(Equal(want), "%+v", target)
		}
	})
})
