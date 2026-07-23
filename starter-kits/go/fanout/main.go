package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/fastly/compute-sdk-go/fsthttp"
	"github.com/fastly/compute-sdk-go/x/exp/handoff"
)

func handleTest(w fsthttp.ResponseWriter, r *fsthttp.Request, channel string) {
	switch r.URL.Path {
	case "/test/long-poll":
		GripResponse(w, "text/plain", "response", channel)
	case "/test/stream":
		GripResponse(w, "text/plain", "stream", channel)
	case "/test/sse":
		GripResponse(w, "text/event-stream", "stream", channel)
	case "/test/websocket":
		handleFanoutWs(w, r, channel)
	default:
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprintf(w, "No such test endpoint\n")
	}
}

func handleFanoutWs(w fsthttp.ResponseWriter, r *fsthttp.Request, channel string) {
	if r.Header.Get("Content-Type") != "application/websocket-events" {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "Not a Websocket-Over-HTTP request.\n")
		return
	}

	// Stream in the request body
	reqBody, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "Error reading request req_body.\n")
		return
	}

	// Echo the request body into the response
	respBody := make([]byte, len(reqBody))
	copy(respBody, reqBody)

	w.Header().Add("Content-Type", "application/websocket-events")

	// Is it an open message?
	if bytes.Equal(reqBody[:6], []byte("OPEN\r\n")) {
		// Subscribe it to the channel
		respBody = append(respBody, WsSub(channel)...)

		// Sec-WebSocket-Extension 'grip' - https://pushpin.org/docs/protocols/grip/#websocket
		// "In order to enable GRIP functionality, the backend must include the grip extension in its response."
		w.Header().Add("Sec-WebSocket-Extensions", "grip; message-prefix=\"\"")
	}

	w.WriteHeader(http.StatusOK)
	w.Write(respBody)
}

func main() {
	// Log service version.
	fmt.Println("FASTLY_SERVICE_VERSION:", os.Getenv("FASTLY_SERVICE_VERSION"))
	fsthttp.ServeFunc(func(ctx context.Context, w fsthttp.ResponseWriter, r *fsthttp.Request) {
		//defer w.Close()
		path := r.URL.Path
		addr := r.RemoteAddr

		w.Header().Set("X-Forwarded-For", addr)

		if strings.ToLower(r.URL.Scheme) == "https" {
			w.Header().Set("X-Forwarded-Proto", "https")
		}

		// Request is a test request
		if strings.HasPrefix(path, "/test/") {
			if r.Header.Get("Grip-Sig") != "" {
				// Request is from Fanout, handle it here
				handleTest(w, r, "test")
				return
			}

			// Not from Fanout, route it through Fanout first
			handoff.Fanout("self")
			return
		}

		// Forward all non-test requests to the origin through Fanout
		handoff.Fanout("origin")
	})
}
