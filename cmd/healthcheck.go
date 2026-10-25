package cmd

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func init() {
	rootCmd.AddCommand(healthcheckCmd)
	healthcheckCmd.Flags().Duration("timeout", 5*time.Second, "how long to wait for the server to answer")
}

var healthcheckCmd = &cobra.Command{
	Use:   "healthcheck",
	Short: "Check that the Lyvune server answers requests",
	Long: "Ask the running server's /ping endpoint, on the address, port and TLS settings it is configured with, " +
		"and exit with 0 when it answers. It needs no curl or wget, so a container's HEALTHCHECK can use it. " +
		"The endpoint needs no login and reveals nothing but that the server is up",
	// Containers run this every few seconds: no banner, no folders created, no database opened
	PersistentPreRun: func(*cobra.Command, []string) {},
	PostRun:          func(*cobra.Command, []string) {},
	Run: func(cmd *cobra.Command, _ []string) {
		timeout, _ := cmd.Flags().GetDuration("timeout")
		ctx, cancel := context.WithTimeout(cmd.Context(), timeout)
		defer cancel()
		target := healthTarget{
			address: viper.GetString("address"),
			port:    viper.GetInt("port"),
			tls:     viper.GetString("tlscert") != "" && viper.GetString("tlskey") != "",
		}
		if err := checkHealth(ctx, target); err != nil {
			fmt.Fprintln(cmd.ErrOrStderr(), "unhealthy:", err)
			os.Exit(1)
		}
	},
}

// healthTarget is where the server listens, as the configuration says
type healthTarget struct {
	address string // IP, empty for all interfaces, or "unix:/path/to/socket"
	port    int
	tls     bool
}

// client and URL to reach the server from the machine it runs on
func (t healthTarget) client() (*http.Client, string) {
	transport := &http.Transport{DisableKeepAlives: true}
	if path, ok := strings.CutPrefix(t.address, "unix:"); ok {
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", path)
		}
		return &http.Client{Transport: transport}, "http://unix/ping"
	}
	host := t.address
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::", "[::]":
		host = "::1"
	}
	scheme := "http"
	if t.tls {
		scheme = "https"
		// The certificate is for the server's public name and this connects to the loopback
		// interface, so it cannot match; nothing but "is it up" is asked or answered
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}
	return &http.Client{Transport: transport}, scheme + "://" + net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(t.port)) + "/ping"
}

// checkHealth succeeds only when the server really answers an HTTP request
func checkHealth(ctx context.Context, t healthTarget) error {
	client, url := t.client()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<10))
	if resp.StatusCode != http.StatusOK {
		return errors.New("the server answered " + resp.Status)
	}
	return nil
}
