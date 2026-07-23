/**
 * Returns a GRIP response to initialize a stream
 *
 * When Compute receives a non-WebSocket request (i.e. normal HTTP) and wants
 * to make it long lived (longpoll or SSE), we call handoff_fanout on it, and
 * Fanout will then forward that request to the nominated backend.  In this app,
 * that backend is this same Compute service, where we then need to respond
 * with some Grip headers to tell Fanout to hold the connection for streaming.
 * This function constructs such a response.
 *
 * @param {string} contentType - Value of Content-Type header to specify
 * @param {string} gripHold - Value of Grip-Hold to specify on the response
 * @param {string} gripChannel - Name of Grip channel to subscribe the response
 */
export function gripResponse(contentType, gripHold, gripChannel) {
  return new Response(
    null, {
      headers: {
        'Content-Type': contentType,
        "Grip-Hold": gripHold,
        "Grip-Channel": gripChannel,
      },
    });
}

const _textEncoder = new TextEncoder();

/**
 * Returns a WebSocket-over-HTTP formatted TEXT message
 *
 * @param {string} message - Text message to send
 */
export function wsText(message) {
  return _textEncoder.encode(`TEXT ${_textEncoder.encode(message).length.toString(16)}\r\n${message}\r\n`);
}

/**
 * Returns a channel-subscription command in a WebSocket-over-HTTP format
 *
 * @param {string} channel - Name of Grip channel to subscribe to
 */
export function wsSubscribe(channel) {
  return wsText('c:' + JSON.stringify({type: 'subscribe', channel}));
}
