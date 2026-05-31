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
const googleClientMatch = env.match(/^GOOGLE_CLIENT_ID=(.+)$/m);
const proxyMatch = env.match(/^BWITHU_PROXY_URL=(.+)$/m);

fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      ...(xaiMatch?.[1] ? { XAI_API_KEY: xaiMatch[1].trim() } : {}),
      ...(braveMatch?.[1] ? { BRAVE_SEARCH_API_KEY: braveMatch[1].trim() } : {}),
      ...(googleClientMatch?.[1] ? { GOOGLE_CLIENT_ID: googleClientMatch[1].trim() } : {}),
      ...(proxyMatch?.[1] ? { BWITHU_PROXY_URL: proxyMatch[1].trim() } : {}),
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${outPath}`);
