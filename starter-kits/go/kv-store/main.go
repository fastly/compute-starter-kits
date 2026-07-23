package main

import (
	"context"
	"io"
	"strings"

	"github.com/fastly/compute-sdk-go/fsthttp"
	"github.com/fastly/compute-sdk-go/kvstore"
)

// The entry point for your application.
//
// Use this function to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.

func main() {
	fsthttp.ServeFunc(func(ctx context.Context, w fsthttp.ResponseWriter, r *fsthttp.Request) {
		/*
			Create an KVStore instance which is connected to the KV Store named `my-store`

			[Documentation for the kvstore open method can be found here](https://pkg.go.dev/github.com/fastly/compute-sdk-go@v0.1.4/kvstore#Open)
		*/
		store, err := kvstore.Open("my-store")
		if err != nil {
			fsthttp.Error(w, err.Error(), fsthttp.StatusInternalServerError)
			return
		}

		if r.URL.Path == "/readme" {
			v, err := store.Lookup("readme")
			if err != nil {
				fsthttp.Error(w, err.Error(), fsthttp.StatusInternalServerError)
				return
			}

			w.WriteHeader(fsthttp.StatusOK)
			// Stream the value back to the user-agent.
			io.Copy(w, v)
			return
		}
		/*
			Adds or updates the key `hello` in the KV Store with the value `world`.

			Note: KV stores are eventually consistent, this means that the updated value associated
			with the key may not be available to read from all edge locations immediately and some edge
			locations may continue returning the previous value associated with the key.

			[Documentation for the Insert method can be found here](https://pkg.go.dev/github.com/fastly/compute-sdk-go@v0.1.4/kvstore#Store.Insert)
		*/

		err = store.Insert("hello", strings.NewReader("world"))

		if err != nil {
			fsthttp.Error(w, err.Error(), fsthttp.StatusInternalServerError)
			return
		}

		/*
			Retrieve the value associated with the key `hello` in the KV Store.

			[Documentation for the Lookup method can be found here](https://pkg.go.dev/github.com/fastly/compute-sdk-go@v0.1.4/kvstore#Store.Lookup)
		*/
		v, err := store.Lookup("hello")
		if err != nil {
			fsthttp.Error(w, err.Error(), fsthttp.StatusInternalServerError)
			return
		}

		w.WriteHeader(fsthttp.StatusOK)
		// Stream the value back to the user-agent.
		io.Copy(w, v)
	})
}
