package main

import (
	"context"
	"fmt"
	"github.com/fastly/compute-sdk-go/fsthttp"
	"github.com/fastly/compute-sdk-go/x/exp/handoff"
	"io"
	"net/http"
	"os"
	"slices"
)

func main() {

	// Log service version.
	fmt.Println("FASTLY_SERVICE_VERSION:", os.Getenv("FASTLY_SERVICE_VERSION"))
	fsthttp.ServeFunc(func(ctx context.Context, w fsthttp.ResponseWriter, r *fsthttp.Request) {
		useFanout := false

		if r.Method == http.MethodGet && slices.Contains(r.Header.Values("upgrade"), "websocket") {
			// If a GET request contains "Upgrade: websocket" in its headers, then hand off to Fanout
			// to handle as WebSocket-over-HTTP.
			// For details on WebSocket-over-HTTP, see https://pushpin.org/docs/protocols/websocket-over-http/
			useFanout = true
		} else if r.Method == http.MethodGet || r.Method == http.MethodHead {
			// If it's a GET or HEAD request, then hand off to Fanout.
			// The backend response can include GRIP control messages to specify connection behavior.
			// For details on GRIP, see https://pushpin.org/docs/protocols/grip/.

			// NOTE: In an actual app we would be selective about which requests are handed off to Fanout,
			// because requests that are handed off to Fanout do not pass through the Fastly cache.
			// For example, we may examine the request path or the existence of certain headers.
			// See https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#what-to-hand-off-to-fanout

			// TODO: add any additional conditions before setting useFanout to true

			useFanout = true
		}

		// Hand off to Fanout or send the request normally.
		if useFanout {
			// Hand off the request through Fanout to the specified backend.
			handoff.Fanout("origin")
		} else {

			// Send the request to the specified backend normally.
			resp, err := r.Send(ctx, "origin")
			if err != nil {
				w.WriteHeader(fsthttp.StatusBadGateway)
				fmt.Fprintln(w, err.Error())
				return
			}

			w.Header().Reset(resp.Header)
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
		}
	})

}
