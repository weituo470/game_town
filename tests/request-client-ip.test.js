import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequestClientIp } from '../server/requestClientIp.js';

const request = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: { 'x-real-ip': forwarded } });

test('forwarded IP is ignored unless local proxy trust is explicitly enabled', () => {
  for (const trustProxyLoopback of [undefined, false, 'true', 1]) {
    assert.equal(getRequestClientIp(request('127.0.0.1', '203.0.113.5'), { trustProxyLoopback }), '127.0.0.1');
  }
});

test('trusted loopback proxy accepts one valid IPv4 or IPv6 address', () => {
  for (const peer of ['127.0.0.1', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
    for (const ip of ['203.0.113.5', '2001:db8::123', ' 203.0.113.5 ']) {
      assert.equal(getRequestClientIp(request(peer, ip), { trustProxyLoopback: true }), ip.trim());
    }
  }
});

test('non-loopback peers cannot spoof the effective address', () => {
  for (const peer of ['203.0.113.1', '10.0.0.1', '::ffff:10.0.0.1', '::ffff:128.0.0.1', '2001:db8::1', '127.invalid']) {
    assert.equal(getRequestClientIp(request(peer, '203.0.113.5'), { trustProxyLoopback: true }), peer);
  }
});

test('invalid, repeated, or chained forwarded addresses fall back to the peer', () => {
  for (const ip of [undefined, null, '', 'localhost', '127.0.0.1:80', '1.2.3.999', '203.0.113.5, 203.0.113.6', ['203.0.113.5'], '203.0.113.5\r\nX-Foo: bar']) {
    assert.equal(getRequestClientIp(request('127.0.0.1', ip), { trustProxyLoopback: true }), '127.0.0.1');
  }
});
