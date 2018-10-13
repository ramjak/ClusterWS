"use strict";

var crypto = require("crypto"), uws = require("@clusterws/uws"), HTTP = require("http"), HTTPS = require("https"), cluster = require("cluster");

function random(e, s) {
    return Math.floor(Math.random() * (s - e + 1)) + e;
}

function logError(e) {
    return process.stdout.write(`[31mError PID ${process.pid}:[0m  ${e}\n`);
}

function logReady(e) {
    return process.stdout.write(`[32m✓ ${e}[0m\n`);
}

function logWarning(e) {
    return process.stdout.write(`[33mWarning PID ${process.pid}:[0m ${e}\n`);
}

function isFunction(e) {
    return "[object Function]" === {}.toString.call(e);
}

function generateKey(e) {
    return crypto.randomBytes(e).toString("hex");
}

class EventEmitter {
    constructor() {
        this.events = {};
    }
    on(e, s) {
        if (!isFunction(s)) return logError("Listener must be a function");
        this.events[e] = s;
    }
    emit(e, ...s) {
        const t = this.events[e];
        t && t(...s);
    }
    exist(e) {
        return !!this.events[e];
    }
    removeEvent(e) {
        delete this.events[e];
    }
    removeEvents() {
        this.events = {};
    }
}

class Channel extends EventEmitter {
    constructor(e, s, t) {
        super(), this.channelName = e, this.subscribers = {}, this.subscribersIds = [], 
        this.batch = [], this.subscribe(s, t);
    }
    publish(e, s) {
        this.batch.push({
            id: e,
            message: s
        });
    }
    subscribe(e, s) {
        this.subscribers[e] = s, this.subscribersIds.push(e);
    }
    unsubscribe(e) {
        const s = this.subscribersIds.indexOf(e);
        -1 !== s && (delete this.subscribers[e], this.subscribersIds.splice(s, 1), this.subscribersIds.length || (this.batch = [], 
        this.subscribers = {}, this.emit("destroy", this.channelName), this.removeEvents()));
    }
    batchFlush() {
        const e = this.batch.length, s = this.subscribersIds.length;
        if (!e) return;
        for (let t = 0; t < s; t++) {
            const s = [], r = this.subscribersIds[t];
            for (let t = 0; t < e; t++) this.batch[t].id !== r && ("from_broker" === this.batch[t].id ? Array.prototype.push.apply(s, this.batch[t].message) : s.push(this.batch[t].message));
            s.length && this.subscribers[r](this.channelName, s);
        }
        const t = [];
        for (let s = 0, r = e; s < r; s++) "from_broker" !== this.batch[s].id && t.push(this.batch[s].message);
        this.batch = [], this.emit("publish", this.channelName, t);
    }
}

class Broker {
    constructor(e, s, t) {
        this.channels = {}, this.server = new uws.WebSocketServer({
            port: e,
            verifyClient: (e, s) => s(e.req.url === `/?token=${t}`)
        }, () => process.send({
            event: "READY",
            pid: process.pid
        })), this.server.on("connection", e => {
            e.id = generateKey(10), e.on("message", s => {
                if ("string" == typeof s) {
                    const [t, r] = JSON.parse(s);
                    if ("u" === t && this.channels[r]) return this.channels[r].unsubscribe(e.id);
                    if (this.channels[r]) this.channels[r].subscribe(e.id, this.messagePublisher.bind(null, e)); else {
                        let s = new Channel(r, e.id, this.messagePublisher.bind(null, e));
                        s.on("publish", (e, s) => {}), s.on("destroy", e => {
                            delete this.channels[e], s = null;
                        }), this.channels[r] = s;
                    }
                } else {
                    const t = (s = Buffer.from(s)).indexOf(37), r = s.slice(0, t).toString();
                    this.channels[r] && this.channels[r].publish(e.id, s.slice(t + 1, s.length));
                }
            }), e.on("error", e => {}), e.on("close", (e, s) => {});
        }), this.flushLoop(), this.server.startAutoPing(2e4);
    }
    messagePublisher(e, s, t) {
        e.send(Buffer.from(`${s}%${JSON.stringify(t)}`));
    }
    flushLoop() {
        setTimeout(() => {
            for (const e in this.channels) this.channels[e] && this.channels[e].batchFlush();
            this.flushLoop();
        }, 10);
    }
}

class Socket {
    constructor(e, s) {
        this.worker = e, this.socket = s, this.id = generateKey(10), this.emitter = new EventEmitter(), 
        this.channels = {}, this.socket.on("message", e => {
            try {
                decode(this, JSON.stringify(e), this.worker.options);
            } catch (e) {
                logError(e);
            }
        }), this.socket.on("close", (e, s) => {
            for (const e in this.channels) this.channels[e] && this.worker.wss.unsubscribe(e, this.id);
            this.emitter.emit("disconnect", e, s), this.emitter.removeEvents();
        }), this.socket.on("error", e => {
            if (!this.emitter.exist("error")) return logError(e), this.socket.terminate();
            this.emitter.emit("error", e);
        });
    }
    on(e, s) {
        this.emitter.on(e, s);
    }
    send(e, s, t = "emit") {
        this.socket.send(encode(e, s, t, this.worker.options));
    }
    disconnect(e, s) {
        this.socket.close(e, s);
    }
    terminate() {
        this.socket.terminate();
    }
    onPublish(e, s) {
        this.send(e, s, "publish");
    }
}

function encode(e, s, t, r) {
    "system" === t && r.encodeDecodeEngine && (s = r.encodeDecodeEngine.encode(s));
    const o = {
        emit: [ "e", e, s ],
        publish: [ "p", e, s ],
        system: {
            configuration: [ "s", "c", s ]
        }
    }, n = JSON.stringify(o[t][e] || o[t]);
    return r.useBinary ? Buffer.from(n) : n;
}

function decode(e, s, t) {
    let [r, o, n] = s;
    switch ("s" !== r && t.encodeDecodeEngine && (n = t.encodeDecodeEngine.decode(n)), 
    r) {
      case "e":
        return e.emitter.emit(o, n);

      case "p":
        return e.channels[o] && e.worker.wss.publish(o, n, e.id);

      case "s":
        const s = e.channels[n];
        "s" !== o || s || (e.channels[n] = 1, e.worker.wss.subscribe(n, e.id, e.onPublish.bind(e))), 
        "u" === o && s && (delete e.channels[n], e.worker.wss.unsubscribe(n, e.id));
    }
}

class BrokerClient {
    constructor(e) {
        this.url = e, this.events = {}, this.attempts = 0, this.createSocket();
    }
    on(e, s) {
        this.events[e] = s;
    }
    send(e) {
        return this.socket.readyState === this.socket.OPEN && (this.socket.send(e), !0);
    }
    createSocket() {
        this.socket = new uws.WebSocket(this.url), this.socket.on("open", () => {
            this.attempts = 0, this.attempts > 1 && logReady(`Reconnected to the Broker: ${this.url}`);
        }), this.socket.on("error", e => {
            (this.attempts > 0 && this.attempts % 10 == 0 || 1 === this.attempts) && logWarning(`Can not connect to the Broker: ${this.url} (reconnecting)`), 
            this.socket = null, this.attempts++, setTimeout(() => this.createSocket(), random(1e3, 2e3));
        }), this.socket.on("close", (e, s) => {
            if (this.socket = null, this.attempts++, 1e3 === e) return logWarning(`Disconnected from Broker: ${this.url} (code ${e})`);
            logWarning(`Disconnected from Broker: ${this.url} (reconnecting)`), setTimeout(() => this.createSocket(), random(1e3, 2e3));
        }), this.socket.on("message", e => {
            const s = this.events.message;
            s && s(e);
        });
    }
}

class WSServer extends EventEmitter {
    constructor(e, s) {
        super(), this.options = e, this.channels = {}, this.middleware = {}, this.brokers = [], 
        this.nextBrokerId = 0;
        for (let e = 0; e < this.options.brokers; e++) {
            const t = new BrokerClient(`ws://127.0.0.1:${this.options.brokersPorts[e]}/?token=${s}`);
            t.on("message", this.onBrokerMessage.bind(this)), this.brokers.push(t);
        }
        this.flushLoop();
    }
    setMiddleware(e, s) {
        this.middleware[e] = s;
    }
    publish(e, s, t) {
        this.channels[e] && this.channels[e].publish(t, s);
    }
    subscribe(e, s, t) {
        if (this.channels[e]) this.channels[e].subscribe(s, t); else {
            let r = new Channel(e, s, t);
            r.on("publish", (s, t) => {
                let r = 0, o = !1;
                if (!t.length) return;
                const n = Buffer.from(`${e}%${JSON.stringify(t)}`), i = this.brokers.length;
                for (;!o && r < 2 * i; ) this.nextBrokerId >= i && (this.nextBrokerId = 0), o = this.brokers[this.nextBrokerId].send(n), 
                r++, this.nextBrokerId++;
            }), r.on("destroy", e => {
                delete this.channels[e], r = null;
                for (let s = 0, t = this.brokers.length; s < t; s++) this.brokers[s].send(JSON.stringify([ "u", e ]));
            }), this.channels[e] = r;
            for (let s = 0, t = this.brokers.length; s < t; s++) this.brokers[s].send(JSON.stringify([ "s", e ]));
        }
    }
    unsubscribe(e, s) {
        this.channels[e].unsubscribe(s);
    }
    onBrokerMessage(e) {
        const s = (e = Buffer.from(e)).indexOf(37), t = e.slice(0, s).toString();
        if (this.channels[t]) {
            const r = [], o = JSON.parse(e.slice(s + 1, e.length));
            for (let e = 0, s = o.length; e < s; e++) Array.prototype.push.apply(r, JSON.parse(Buffer.from(o[e])));
            this.channels[t].publish("from_broker", r);
        }
    }
    flushLoop() {
        setTimeout(() => {
            for (const e in this.channels) this.channels[e] && this.channels[e].batchFlush();
            this.flushLoop();
        }, 10);
    }
}

class Worker {
    constructor(e, s) {
        this.options = e, this.wss = new WSServer(this.options, s), this.server = this.options.tlsOptions ? HTTPS.createServer(this.options.tlsOptions) : HTTP.createServer();
        const t = new uws.WebSocketServer({
            server: this.server
        });
        t.on("connection", e => {
            this.wss.emit("connection", new Socket(this, e));
        }), t.startAutoPing(this.options.pingInterval, !0), this.server.on("error", e => {
            logError(`${e.stack || e}`), process.exit();
        }), this.server.listen(this.options.port, this.options.host, () => {
            this.options.worker.call(this), process.send({
                event: "READY",
                pid: process.pid
            });
        });
    }
}

function masterProcess(e) {
    let s = !1;
    const t = [], r = [], o = generateKey(20), n = generateKey(20);
    if (e.horizontalScaleOptions && e.horizontalScaleOptions.masterOptions) i("Scaler", -1); else for (let s = 0; s < e.brokers; s++) i("Broker", s);
    function i(h, c) {
        const l = cluster.fork();
        l.on("message", o => {
            if ("READY" === o.event) {
                if (s) return logReady(`${h} ${c} PID ${o.pid} has been restarted`);
                switch (h) {
                  case "Broker":
                    if (t[c] = ` Broker on: ${e.brokersPorts[c]}, PID ${o.pid}`, !t.includes(void 0) && t.length === e.brokers) for (let s = 0; s < e.workers; s++) i("Worker", s);
                    break;

                  case "Worker":
                    r[c] = `    Worker: ${c}, PID ${o.pid}`, r.includes(void 0) || r.length !== e.workers || (s = !0, 
                    logReady(` Master on: ${e.port}, PID ${process.pid} ${e.tlsOptions ? "(secure)" : ""}`), 
                    t.forEach(logReady), r.forEach(logReady));
                    break;

                  case "Scaler":
                    for (let s = 0; s < e.brokers; s++) i("Broker", s);
                }
            }
        }), l.on("exit", () => {
            logError(`${h} ${c} has exited`), e.restartWorkerOnFail && (logWarning(`${h} ${c} is restarting \n`), 
            i(h, c));
        }), l.send({
            processId: c,
            processName: h,
            serverId: o,
            internalSecurityKey: n
        });
    }
}

function workerProcess(e) {
    process.on("message", s => {
        switch (s.processName) {
          case "Worker":
            return new Worker(e, s.internalSecurityKey);

          case "Broker":
            return new Broker(e.brokersPorts[s.processId], e, s.internalSecurityKey);
        }
    }), process.on("uncaughtException", e => {
        logError(`${e.stack || e}`), process.exit();
    });
}

class ClusterWS {
    constructor(e) {
        if (this.options = {
            port: e.port || (e.tlsOptions ? 443 : 80),
            host: e.host,
            worker: e.worker,
            workers: e.workers || 1,
            brokers: e.brokers || 1,
            useBinary: e.useBinary,
            tlsOptions: e.tlsOptions,
            pingInterval: e.pingInterval || 2e4,
            brokersPorts: e.brokersPorts || [],
            encodeDecodeEngine: e.encodeDecodeEngine,
            restartWorkerOnFail: e.restartWorkerOnFail,
            horizontalScaleOptions: e.horizontalScaleOptions
        }, !this.options.brokersPorts.length) for (let e = 0; e < this.options.brokers; e++) this.options.brokersPorts.push(e + 9400);
        return isFunction(this.options.worker) ? this.options.brokers !== this.options.brokersPorts.length ? logError("Number of broker ports should be the same as number of brokers") : void (cluster.isMaster ? masterProcess(this.options) : workerProcess(this.options)) : logError("Worker must be provided and it must be a function");
    }
}

module.exports = ClusterWS; module.exports.default = ClusterWS;
