import * as HTTP from 'http';
import * as HTTPS from 'https';

import { Socket } from './socket/socket';
import { WSServer } from './socket/wsserver';
import { logError } from '../utils/functions';
import { Options, Listener, Middleware } from '../utils/types';
import { WebSocket, WebSocketServer, ConnectionInfo } from '@clusterws/cws';

export class Worker {
  public wss: WSServer;
  public server: HTTP.Server | HTTPS.Server;

  constructor(public options: Options, internalSecurityKey: string) {
    this.wss = new WSServer(this.options, internalSecurityKey);
    this.server = this.options.tlsOptions ? HTTPS.createServer(this.options.tlsOptions) : HTTP.createServer();

    const uServer: WebSocketServer = new WebSocketServer({
      path: this.options.wsPath,
      server: this.server,
      verifyClient: (info: ConnectionInfo, next: Listener): void => {
        this.wss.middleware.verifyConnection ?
          this.wss.middleware.verifyConnection(info, next) :
          next(true);
      }
    });

    uServer.on('connection', (socket: WebSocket) => {
      this.wss.emit('connection', new Socket(this, socket));
    });

    uServer.startAutoPing(this.options.pingInterval, true);

    this.server.on('error', (error: Error) => {
      logError(`Worker ${error.stack || error}`);
      process.exit();
    });

    this.server.listen(this.options.port, this.options.host, (): void => {
      this.options.worker.call(this);
      process.send({ event: 'READY', pid: process.pid });
    });
  }
}