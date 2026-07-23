package main

import (
	"fmt"
	"github.com/fastly/compute-sdk-go/fsthttp"
	"net/http"
)

// GripResponse returns a GRIP response to initialize a stream
// When Compute receives a non-WebSocket request (i.e. normal HTTP) and wants
// to make it long lived (longpoll or SSE), we call handoff_fanout on it, and
// Fanout will then forward that request to the nominated backend.  In this app,
// that backend is this same Compute service, where we then need to respond
// with some Grip headers to tell Fanout to hold the connection for streaming.
// This function constructs such a response.
//
// Parameters:
//
//	ctype - Value of Content-Type header to specify
//	ghold - Value of Grip-Hold to specify on the response
//	channel - Name of Grip channel to subscribe the response
func GripResponse(w fsthttp.ResponseWriter, ctype string, ghold string, channel string) {
	w.Header().Add("Content-Type", ctype)
	w.Header().Add("Grip-Hold", ghold)
	w.Header().Add("Grip-Channel", channel)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(""))
}

// WsText returns a WebSocket-over-HTTP formatted TEXT message
//
// Parameters:
//
//	msg - Text message to send
func WsText(msg string) []byte {
	return []byte(fmt.Sprintf("TEXT %2x\r\n%s\r\n", len(msg), msg))
}

// WsSub returns a channel-subscription command in a WebSocket-over-HTTP format
//
// Parameters:
//
//	channel - Name of Grip channel to subscribe to
func WsSub(channel string) []byte {
	return WsText(fmt.Sprintf("c:{\"type\":\"subscribe\",\"channel\":\"%s\"}", channel))
}
