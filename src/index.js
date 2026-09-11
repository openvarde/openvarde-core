import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import mqtt from "mqtt";
import { Bonjour } from "bonjour-service";

const VERSION = "0.2.0";

const DATA_DIR = process.env.OPENVARDE_DATA_DIR || "/var/lib/openvarde";

const NODE_FILE = path.join(DATA_DIR, "node.json");

const PORT = Number(process.env.PORT || 8081);

const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";

/*
 * Node identity
 */

function generateNodeId() {
  return `ov-${crypto.randomBytes(16).toString("hex")}`;
}

function getShortNodeId(nodeId) {
  return nodeId.replace(/^ov-/, "").slice(0, 8);
}

function loadOrCreateNode() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true,
    mode: 0o700,
  });

  if (fs.existsSync(NODE_FILE)) {
    const data = JSON.parse(fs.readFileSync(NODE_FILE, "utf8"));

    if (!data.node_id) {
      throw new Error(`${NODE_FILE} exists but does not contain node_id`);
    }

    console.log(`Loaded node identity: ${data.node_id}`);

    return data;
  }

  const node = {
    schema_version: 1,
    node_id: generateNodeId(),
    name: null,
    created_at: new Date().toISOString(),
  };

  const temporaryFile = `${NODE_FILE}.tmp`;

  fs.writeFileSync(temporaryFile, JSON.stringify(node, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  fs.renameSync(temporaryFile, NODE_FILE);

  console.log(`Created new node identity: ${node.node_id}`);

  return node;
}

const node = loadOrCreateNode();

const shortId = getShortNodeId(node.node_id);

const nodeName = node.name || `OpenVarde ${shortId}`;

const mdnsHostname = `openvarde-${shortId}.local`;

/*
 * MQTT
 */

const STATUS_TOPIC = `openvarde/nodes/${node.node_id}/status`;

const offlineStatus = JSON.stringify({
  status: "offline",
  node_id: node.node_id,
  short_id: shortId,
  name: nodeName,
  hostname: mdnsHostname,
  service: "openvarde-core",
  version: VERSION,
});

const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: `openvarde-core-${node.node_id}`,
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
    node_id: node.node_id,
    short_id: shortId,
    name: nodeName,
    hostname: mdnsHostname,
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
 * HTTP API
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
      node_id: node.node_id,
      short_id: shortId,
      name: nodeName,
      hostname: mdnsHostname,
      mqtt_connected: mqttClient.connected,
    });

    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/openvarde") {
    sendJson(res, 200, {
      openvarde: "0.1",

      node: {
        id: node.node_id,
        short_id: shortId,
        name: nodeName,
        hostname: mdnsHostname,
        created_at: node.created_at || null,
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
 * mDNS / DNS-SD discovery
 */

const bonjour = new Bonjour({}, (error) => {
  console.error("mDNS error:", error);
});

let discoveryService = null;

function startDiscovery() {
  discoveryService = bonjour.publish({
    name: nodeName,

    type: "openvarde",

    protocol: "tcp",

    host: mdnsHostname,

    port: PORT,

    txt: {
      version: VERSION,
      node_id: node.node_id,
      short_id: shortId,
      well_known: "/.well-known/openvarde",
    },
  });

  discoveryService.on("up", () => {
    console.log(`OpenVarde discovery published`);

    console.log(`Service: ${nodeName}._openvarde._tcp.local`);

    console.log(`mDNS hostname: ${mdnsHostname}`);
  });

  discoveryService.on("error", (error) => {
    console.error("Failed to publish OpenVarde discovery:", error);
  });
}

/*
 * Graceful shutdown
 */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);

  if (discoveryService) {
    try {
      discoveryService.stop();
    } catch (error) {
      console.error("Failed to stop mDNS service:", error);
    }
  }

  try {
    bonjour.destroy();
  } catch (error) {
    console.error("Failed to destroy Bonjour:", error);
  }

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

  console.log(`Node ID: ${node.node_id}`);

  console.log(`Short ID: ${shortId}`);

  console.log(`Node name: ${nodeName}`);

  console.log(`mDNS hostname: ${mdnsHostname}`);

  console.log(`Listening on port ${PORT}`);

  startDiscovery();
});
