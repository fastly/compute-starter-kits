package main

import (
	"context"
	"fmt"
	"github.com/fastly/compute-sdk-go/fsthttp"
	"github.com/fastly/compute-sdk-go/x/exp/handoff"
	"io"
	"os"
)

// The entry point for your application.
//
// Use this function to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.
func main() {
	// Log service version.
	fmt.Println("FASTLY_SERVICE_VERSION:", os.Getenv("FASTLY_SERVICE_VERSION"))

	// Fastly Compute request handler
	fsthttp.ServeFunc(func(ctx context.Context, w fsthttp.ResponseWriter, r *fsthttp.Request) {

		if r.Header.Get("upgrade") == "websocket" {

			// Create a WebSocket tunnel to the specified backend and "hand off" the request through it
			handoff.Websocket("backend")

		} else {

			// Send the request to the specified backend normally.
			r.CacheOptions.Pass = true
			resp, err := r.Send(ctx, "backend")
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
