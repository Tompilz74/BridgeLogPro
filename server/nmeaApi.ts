import http from "node:http";
import { NmeaTcpServer, type NmeaFeedState } from "./nmea0183";

type NmeaApiOptions = {
  listenHost: string;
  listenPort: number;
  simulatorEnabled: boolean;
};

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function writeSse(res: http.ServerResponse, state: NmeaFeedState): void {
  res.write(`event: nmea-state\n`);
  res.write(`data: ${JSON.stringify(state)}\n\n`);
}

export function createNmeaApiHandler(options: NmeaApiOptions) {
  const nmeaServer = new NmeaTcpServer(options);
  nmeaServer.start();

  return (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    if (req.method !== "GET") {
      next();
      return;
    }

    if (req.url?.startsWith("/events")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const onState = (state: NmeaFeedState) => writeSse(res, state);
      nmeaServer.on("state", onState);
      writeSse(res, nmeaServer.getState());

      req.on("close", () => {
        nmeaServer.off("state", onState);
      });
      return;
    }

    if (!req.url || req.url === "/" || req.url.startsWith("/state")) {
      jsonResponse(res, 200, nmeaServer.getState());
      return;
    }

    next();
  };
}

