import express from "express";
import type { Request, Response } from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { addObservation, listObservations, loadSeeds } from "./store.js";
import type { NewObservation, Observation } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

const app = express();
app.use(express.json());

interface ErrorBody {
  error: string;
}

// Returns all observations, optionally filtered by the ?familyId= query parameter.
function handleList(
  req: Request<{}, Observation[], unknown, { familyId?: string }>,
  res: Response<Observation[]>,
): void {
  const { familyId } = req.query;
  const all = listObservations();
  res.json(typeof familyId === "string" && familyId !== "" ? all.filter((o) => o.familyId === familyId) : all);
}

// Validates the posted body, stores a new observation, and responds 201 with it.
function handleCreate(
  req: Request<{}, Observation | ErrorBody, Partial<Record<keyof NewObservation, unknown>>>,
  res: Response<Observation | ErrorBody>,
): void {
  const body = req.body ?? {};
  const { familyId, text } = body;
  if (typeof familyId !== "string" || familyId.trim() === "") {
    res.status(400).json({ error: "familyId must be a non-empty string" });
    return;
  }
  if (typeof text !== "string" || text.trim() === "") {
    res.status(400).json({ error: "text must be a non-empty string" });
    return;
  }
  const created = addObservation({ familyId: familyId.trim(), text: text.trim() });
  res.status(201).json(created);
}

app.get("/api/observations", handleList);
app.post("/api/observations", handleCreate);
app.use(express.static(publicDir));

const seeded = loadSeeds();
console.log(`Loaded ${seeded} seed observations`);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`signalsense listening on http://localhost:${port}`);
});
