import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.OPENVARDE_DATA_DIR || "/var/lib/openvarde";

const NODE_FILE = path.join(DATA_DIR, "node.json");

function generateNodeId() {
  return `ov-${crypto.randomBytes(16).toString("hex")}`;
}

export function getShortNodeId(nodeId) {
  return nodeId.replace(/^ov-/, "").slice(0, 8);
}

export function loadOrCreateNode() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true,
    mode: 0o700,
  });

  if (fs.existsSync(NODE_FILE)) {
    const data = JSON.parse(fs.readFileSync(NODE_FILE, "utf8"));

    if (!data.node_id) {
      throw new Error(`${NODE_FILE} exists but does not contain node_id`);
    }

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

  return node;
}

export function getNodeMetadata(node) {
  const shortId = getShortNodeId(node.node_id);

  return {
    id: node.node_id,
    shortId,
    name: node.name || `OpenVarde ${shortId}`,
    hostname: `openvarde-${shortId}.local`,
    createdAt: node.created_at || null,
  };
}
