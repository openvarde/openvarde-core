import http from "node:http";
import mqtt from "mqtt";

import { loadOrCreateNode, getNodeMetadata } from "./identity.js";

const VERSION = "0.2.0";

const PORT = Number(process.env.PORT || 8081);

const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";

/*
 * Node identity
 */

const node = loadOrCreateNode();

const metadata = getNodeMetadata(node);

console.log(`OpenVarde node identity: ${metadata.id}`);

/*
 * MQTT
 */

const STATUS_TOPIC = `openvarde/nodes/${metadata.id}/status`;

const offlineStatus = JSON.stringify({
  status: "offline",
  node_id: metadata.id,
  short_id: metadata.shortId,
  name: metadata.name,
  hostname: metadata.hostname,
  service: "openvarde-core",
  version: VERSION,
});

const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: `openvarde-core-${metadata.shortId}`,

  clean: true,

  reconnectPeriod: 5000,

  will: {
    topic: STATUS_TOPIC,
    payload: offlineStatus,
    qos: 1,
    retain: true,
  },
});

mqttClient.on("connect", () => {
  console.log(`Connected to MQTT broker: ${MQTT_URL}`);

  const onlineStatus = JSON.stringify({
    status: "online",
    node_id: metadata.id,
    short_id: metadata.shortId,
    name: metadata.name,
    hostname: metadata.hostname,
    service: "openvarde-core",
    version: VERSION,
    started_at: new Date().toISOString(),
  });

  mqttClient.publish(
    STATUS_TOPIC,
    onlineStatus,
    {
      qos: 1,
      retain: true,
    },
    (error) => {
      if (error) {
        console.error("Failed to publish node status:", error);

        return;
      }

      console.log(`Published online status to ${STATUS_TOPIC}`);
    },
  );
});

mqttClient.on("reconnect", () => {
  console.log(`Reconnecting to MQTT broker: ${MQTT_URL}`);
});

mqttClient.on("offline", () => {
  console.warn("MQTT client is offline");
});

mqttClient.on("error", (error) => {
  console.error("MQTT error:", error);
});

/*
 * HTTP
 */

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",

    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "openvarde-core",
      version: VERSION,

      node_id: metadata.id,

      short_id: metadata.shortId,

      name: metadata.name,

      hostname: metadata.hostname,

      mqtt_connected: mqttClient.connected,
    });

    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/openvarde") {
    sendJson(res, 200, {
      openvarde: "0.1",

      node: {
        id: metadata.id,

        short_id: metadata.shortId,

        name: metadata.name,

        hostname: metadata.hostname,

        created_at: metadata.createdAt,
      },

      core: {
        service: "openvarde-core",

        version: VERSION,
      },

      endpoints: {
        health: "/health",

        discovery: "/.well-known/openvarde",
      },
    });

    return;
  }

  sendJson(res, 404, {
    error: "not_found",
  });
});

/*
 * Graceful shutdown
 */

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);

  server.close(() => {
    console.log("HTTP server stopped");
  });

  if (mqttClient.connected) {
    mqttClient.publish(
      STATUS_TOPIC,
      offlineStatus,
      {
        qos: 1,
        retain: true,
      },
      () => {
        mqttClient.end(false, {}, () => {
          process.exit(0);
        });
      },
    );

    return;
  }

  mqttClient.end(true);

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGINT", () => shutdown("SIGINT"));

/*
 * Startup
 */

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenVarde Core ${VERSION}`);

  console.log(`Node ID: ${metadata.id}`);

  console.log(`Short ID: ${metadata.shortId}`);

  console.log(`Node name: ${metadata.name}`);

  console.log(`Hostname: ${metadata.hostname}`);

  console.log(`HTTP port: ${PORT}`);
});
