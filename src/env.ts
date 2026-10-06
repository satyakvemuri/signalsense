import { fileURLToPath } from "node:url";
import path from "node:path";

// Loads the project's .env into process.env if the file exists (Node built-in; no extra dependency).
function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"));
  } catch {
    // no .env file — rely on the real environment
  }
}

loadDotEnv();
