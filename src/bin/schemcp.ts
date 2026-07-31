#!/usr/bin/env node

import process from "node:process";

const [command] = process.argv.slice(2);

if (command === undefined) {
  await import("../mcp/main.js");
} else if (command === "mcp") {
  process.argv.splice(2, 1);
  await import("../mcp/main.js");
} else {
  await import("../cli/main.js");
}
