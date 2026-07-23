package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/fastly/compute-sdk-go/fsthttp"
)

// The entry point for your application.
//
// Use this function to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.
func main() {
	// Log service version
	fmt.Println("FASTLY_SERVICE_VERSION:", os.Getenv("FASTLY_SERVICE_VERSION"))

	fsthttp.ServeFunc(func(ctx context.Context, w fsthttp.ResponseWriter, r *fsthttp.Request) {

		// ## Advanced Caching use case: Modifying a request as it is forwarded to a backend

		// Sometimes it is useful to perform modifications to the incoming Request before invoking the
		// origin through the readthrough cache. Set BeforeSend on CacheOptions to define a before-send
		// callback function, an operation to be performed just before the readthrough cache would
		// invoke the backend.
		//
		// For details on the before-send callback function, see
		// https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-a-request-as-it-is-forwarded-to-a-backend
		r.CacheOptions.BeforeSend = func(r *fsthttp.Request) error {
			fmt.Println("in before-send callback function")

			// Example: Inject headers before sending
			//
			// In this example, we use the before-send callback function to add an authorization header.
			// If building the header is an expensive operation, then it makes sense to add this
			// header only if the request would make it to the backend.
			authHeader := "Foo"
			r.Header.Set("Authorization", authHeader)
			return nil
		}

		// ## Advanced Caching use case: Controlling cache behavior based on backend response

		// Sometimes it is useful to perform operations based on the backend response. Set
		// AfterSend on CacheOptions to define an after-send callback function, an operation that runs
		// only when the readthrough cache has received a response from the backend, before it is
		// (potentially) stored into the cache.
		//
		// The CandidateResponse object passed to the callback represents the response from the backend
		// and contains interfaces to read and manipulate headers and cache policy. It
		// does not allow reading or writing directory the response body (more on that later).
		//
		// For details on the after-send callback function, see
		// https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#controlling-cache-behavior-based-on-backend-response

		r.CacheOptions.AfterSend = func(cr *fsthttp.CandidateResponse) error {
			fmt.Println("in after-send callback function")

			// Example: Customize caching based on content-type
			//
			// This example shows usages that use some members of CandidateResponse.
			//
			// * func (cr *CandidateResponse) SetTTL(ttl uint32) - override the Time to Live (TTL) of the object in the cache
			// * func (cr *CandidateResponse) SetUncacheable() error - specify that this object is not to be stored in the cache
			//
			// For details on CandidateResponse, see
			// https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#the-candidateresponse-object
			contentType, _ := cr.Header("Content-Type")

			switch {
			case strings.HasPrefix(contentType, "image"):
				cr.SetTTL(67)
			case contentType == "text/html":
				cr.SetTTL(321)
			case contentType == "application/json":
				cr.SetUncacheable()
			default:
				cr.SetTTL(30)
			}

			// Example: Creating a hit-for-pass object
			//
			// By calling SetUncacheableDisableCollapsing() on CandidateResponse, you mark the
			// request as "hit-for-pass", which is a marker in the cache to disable request collapsing
			// for this object until a cacheable response is returned.
			if _, err := cr.Header("my-private-header"); err == nil {
				cr.SetUncacheableDisableCollapsing()
			}

			// Example: Manipulating the response body that is stored to the cache
			//
			// In an after-send callback, optionally call SetBodyTransform() on CandidateResponse
			// to set a body-transform callback. When the cache interface receives the response
			// body from the backend, it invokes the body-transform callback, passing in an io.ReadCloser
			// object that represents the body of the response received from the backend. The callback
			// is expected to return an io.ReadCloser representing the transformed body. This transformed
			// body is stored into the cache and returned to the client from the send operation.
			//
			// The transformation is declared in this way rather than directly working with the body
			// during the after-send callback function, because not every response contains a fresh
			// body. Specifically, 304 Not Modified responses, which are used to revalidate a stale
			// cached response, are valuable precisely because they do not retransmit the body; in
			// this case, the backend and (if specified) your after-send callback function update
			// the headers and cache policy of the existing response object "in-place", without
			// applying the body-transform or changing the cached response body.
			//
			// This design enables the readthrough cache to internally manage the complexities of
			// revalidation, allowing the developer to provide a single code path without needing
			// to think about revalidation at all.
			//
			// In this example, a transformation is made from JSON content to an HTML snippet
			// and saved to the cache.
			//
			// For details on the body-transform callback function, see
			// https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-the-body-that-is-saved-to-the-cache
			if contentType == "application/json" {
				cr.SetHeader("Content-Type", "text/html")

				cr.SetBodyTransform(func(body io.ReadCloser) io.ReadCloser {
					fmt.Println("in body-transform callback function")

					defer body.Close()

					// Read the entire body (in real use, prefer streaming!)
					inputBytes, err := io.ReadAll(body)
					if err != nil {
						return errorReader{err}
					}

					// Parse JSON
					var obj map[string]interface{}
					if err := json.Unmarshal(inputBytes, &obj); err != nil {
						return errorReader{err}
					}

					// Extract values
					firstName, _ := obj["firstName"].(string)
					lastName, _ := obj["lastName"].(string)

					// Build HTML
					html := fmt.Sprintf("<div>%s %s</div>", firstName, lastName)

					// Return as io.ReadCloser
					return io.NopCloser(bytes.NewReader([]byte(html)))
				})

			}

			return nil
		}

		resp, err := r.Send(ctx, "origin")
		if err != nil {
			w.WriteHeader(fsthttp.StatusBadGateway)
			fmt.Fprintln(w, err.Error())
			return
		}

		w.Header().Reset(resp.Header)
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})
}

// errorReader is an io.ReadCloser that always returns a given error on Read().
// Useful to simulate transform failures or propagate upstream errors.
type errorReader struct {
	err error
}

func (e errorReader) Read([]byte) (int, error) {
	return 0, e.err
}
func (e errorReader) Close() error {
	return nil
}
