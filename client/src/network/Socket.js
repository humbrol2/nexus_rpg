/**
 * WebSocket wrapper — sends JWT auth token on connect.
 */
import { getToken } from '../auth.js';

export class GameSocket {
  constructor(url = null) {
    if (!url) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
      url = `${proto}//${host}/ws`;
    }
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.reconnectDelay = 2000;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      // Send auth token as first message
      const token = getToken();
      if (token) {
        this.ws.send(JSON.stringify({ token }));
      }
      this.connected = true;
      this._emit('open');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_fail') {
          console.error('[Socket] Auth failed:', msg.reason);
          localStorage.removeItem('sc_token');
          localStorage.removeItem('sc_username');
          localStorage.removeItem('sc_is_admin');
          alert(msg.reason === 'banned' ? 'Your account has been banned.' : 'Session expired. Please login again.');
          window.location.reload();
          return;
        }
        if (msg.type === 'kicked') {
          alert(msg.reason || 'You have been kicked.');
          localStorage.removeItem('sc_token');
          localStorage.removeItem('sc_username');
          localStorage.removeItem('sc_is_admin');
          window.location.reload();
          return;
        }
        if (msg.type === 'batch') {
          for (const m of msg.messages) this._emit(m.type, m);
        } else {
          this._emit(msg.type, msg);
        }
      } catch (e) {
        console.error('[Socket] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('[Socket] Disconnected, reconnecting...');
      setTimeout(() => this.connect(), this.reconnectDelay);
    };

    this.ws.onerror = (err) => {
      console.error('[Socket] Error:', err);
    };
  }

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  _emit(type, data) {
    const list = this.handlers[type];
    if (list) list.forEach(fn => fn(data));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
