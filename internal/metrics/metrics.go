// Package metrics provides Prometheus instrumentation shared by the Nixway
// control-plane services (api, worker). It exposes an HTTP middleware for
// request metrics, a /metrics handler, a tiny standalone metrics server for
// services without their own HTTP listener, and a couple of domain counters.
//
// Everything registers on the client_golang default registry, which already
// carries Go runtime and process collectors, so scraping /metrics yields
// goroutines, memory, GC, CPU and open-fd telemetry for free.
package metrics

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "nixway_http_requests_total",
	Help: "Total HTTP requests handled, by method and response code.",
}, []string{"method", "code"})

var httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "nixway_http_request_duration_seconds",
	Help:    "HTTP request latency in seconds, by method.",
	Buckets: prometheus.DefBuckets,
}, []string{"method"})

var jobsProcessed = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "nixway_worker_jobs_total",
	Help: "Total background jobs processed, by job kind and status (ok|error).",
}, []string{"kind", "status"})

// Handler returns the Prometheus scrape handler for /metrics.
func Handler() http.Handler {
	return promhttp.Handler()
}

// statusRecorder captures the response status code for metrics.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

// Ensure the wrapper stays transparent to streaming + hijacking so SSE and
// WebSocket handlers keep working through this middleware.
var (
	_ http.Flusher  = (*statusRecorder)(nil)
	_ http.Hijacker = (*statusRecorder)(nil)
)

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

// Flush forwards to the underlying ResponseWriter so SSE/streaming handlers
// keep working. Embedding the http.ResponseWriter interface does NOT promote
// the concrete writer's Flush method to a type assertion on this wrapper, so
// without this, `w.(http.Flusher)` fails and streaming endpoints 500.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards to the underlying ResponseWriter so WebSocket upgrades keep
// working (same interface-embedding caveat as Flush).
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("metrics: underlying ResponseWriter does not support hijacking")
}

// Middleware records request count (by method + status code) and latency
// (by method) for every request passing through it.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 0}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		httpRequests.WithLabelValues(r.Method, strconv.Itoa(rec.status)).Inc()
		httpDuration.WithLabelValues(r.Method).Observe(time.Since(start).Seconds())
	})
}

// RecordJob increments the background-job counter. status should be "ok" or
// "error". Call it from a worker's Work method, typically via defer.
func RecordJob(kind string, err error) {
	status := "ok"
	if err != nil {
		status = "error"
	}
	jobsProcessed.WithLabelValues(kind, status).Inc()
}

// StartServer runs a minimal HTTP server exposing /metrics and /healthz on the
// given address (e.g. ":8090"). It's meant for services like the worker that
// have no HTTP listener of their own. It returns the server so the caller can
// shut it down; serve errors are logged, not fatal.
func StartServer(addr string, logger *slog.Logger) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", Handler())
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		logger.Info("metrics server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("metrics server error", "error", err)
		}
	}()
	return srv
}

// Shutdown gracefully stops a metrics server started with StartServer.
func Shutdown(ctx context.Context, srv *http.Server) {
	if srv != nil {
		_ = srv.Shutdown(ctx)
	}
}
