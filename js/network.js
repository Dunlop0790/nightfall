// Thin WebSocket wrapper. One connection, one message callback, one send path.

export class Net {
  constructor(url, onMessage) {
    this.ws = new WebSocket(url);
    this.openCb = null;
    this.closeCb = null;
    this.ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    this.ws.onopen = () => { if (this.openCb) this.openCb(); };
    this.ws.onclose = () => { if (this.closeCb) this.closeCb(); };
  }

  onOpen(cb) { this.openCb = cb; if (this.ws.readyState === 1) cb(); }
  onClose(cb) { this.closeCb = cb; }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
