const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "public", "local-config.json");

if (!fs.existsSync(envPath)) {
  console.error("No .env file found.");
  process.exit(1);
}

const env = fs.readFileSync(envPath, "utf8");
const match = env.match(/^XAI_API_KEY=(.+)$/m);

if (!match?.[1]) {
  console.error("XAI_API_KEY was not found in .env.");
  process.exit(1);
}

fs.writeFileSync(outPath, `${JSON.stringify({ XAI_API_KEY: match[1].trim() }, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
