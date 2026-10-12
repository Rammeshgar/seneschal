// Agent Trail's packaged ingest server has no host option. Keep both services
// private when launched by Seneschal, including subprocesses via NODE_OPTIONS.
'use strict';
const net = require('net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'object' && args[0] && args[0].port !== undefined) args[0] = { ...args[0], host: '127.0.0.1' };
  else if (typeof args[0] === 'number') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  }
  return listen.apply(this, args);
};
