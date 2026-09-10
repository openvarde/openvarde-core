import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import mqtt from "mqtt";

const VERSION = "0.1.0";

const DATA_DIR = process.env.OPENVARDE_DATA_DIR || "/var/lib/openvarde";

const NODE_FILE = path.join(DATA_DIR, "node.json");

function generateNodeId() {
  return `ov-${crypto.randomBytes(16).toString("hex")}`;
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

const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";

const STATUS_TOPIC = `openvarde/nodes/${node.node_id}/status`;

const offlineStatus = JSON.stringify({
  status: "offline",
  node_id: node.node_id,
});

const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: `openvarde-core-${node.node_id}`,
  clean: true,

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
    service: "openvarde-core",
    version: VERSION,
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

mqttClient.on("error", (error) => {
  console.error("MQTT error:", error);
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        status: "ok",
        service: "openvarde-core",
        version: VERSION,
        node_id: node.node_id,
      }),
    );

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json",
  });

  res.end(
    JSON.stringify({
      error: "not_found",
    }),
  );
});

const PORT = Number(process.env.PORT || 8081);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenVarde Core ${VERSION}`);
  console.log(`Node ID: ${node.node_id}`);
  console.log(`Listening on port ${PORT}`);
});
