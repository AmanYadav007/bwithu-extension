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
const xaiMatch = env.match(/^XAI_API_KEY=(.+)$/m);
const braveMatch = env.match(/^(?:BRAVE_SEARCH_API_KEY|BRAVE_API_KEY)=(.+)$/m);

if (!xaiMatch?.[1]) {
  console.error("XAI_API_KEY was not found in .env.");
  process.exit(1);
}

fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      XAI_API_KEY: xaiMatch[1].trim(),
      ...(braveMatch?.[1] ? { BRAVE_SEARCH_API_KEY: braveMatch[1].trim() } : {}),
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${outPath}`);
