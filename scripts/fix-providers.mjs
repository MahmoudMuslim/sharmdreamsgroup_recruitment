import { readFileSync, writeFileSync } from "fs";

const file = "src/modules/settings/domain/providers.ts";
const content = readFileSync(file, "utf8");

// Find the exact problematic section
const search = `  }\n\n/* -------------------------------------------------------------------------- */\n/* Provider model catalogue (synced from provider_models table)               */\n/* -------------------------------------------------------------------------- */ (synced from provider_models table)               */\n/* -------------------------------------------------------------------------- */\n\nexport interface ProviderModel`;

const replace = `  }\n}\n\n/* -------------------------------------------------------------------------- */\n/* Provider model catalogue (synced from provider_models table)               */\n/* -------------------------------------------------------------------------- */\n\nexport interface ProviderModel`;

const newContent = content.replace(search, replace);

if (newContent === content) {
  console.log("Search pattern not found");
  // Let's find what's actually there
  const idx = content.indexOf("}\n\n/* -------------------------------------------------------------------------- */");
  if (idx >= 0) {
    console.log("Found at:", idx);
    console.log("Context:", JSON.stringify(content.substring(idx, idx + 300)));
  }
} else {
  writeFileSync("src/modules/settings/domain/providers.ts", newContent, "utf8");
  console.log("Fixed!");
}