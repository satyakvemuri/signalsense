import "./env.js";
import express from "express";
import type { Request, Response } from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { addObservation, getObservation, listFamilyIds, listObservations, loadSeeds } from "./store.js";
import { createMem0ServiceFromEnv } from "./mem0.js";
import { buildClusters, findConvergence, syncObservations } from "./convergence.js";
import type {
  ClustersResponse,
  Convergence,
  CreateObservationResponse,
  NewObservation,
  Observation,
} from "./types.js";

const mem = createMem0ServiceFromEnv();

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

// Validates the posted body, stores it, mirrors it to Mem0, and reports which OTHER families said something similar.
async function handleCreate(
  req: Request<{}, CreateObservationResponse | ErrorBody, Partial<Record<keyof NewObservation, unknown>>>,
  res: Response<CreateObservationResponse | ErrorBody>,
): Promise<void> {
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
  const observation = addObservation({ familyId: familyId.trim(), text: text.trim() });

  let convergence: Convergence = { available: false, count: 0, matches: [] };
  if (mem) {
    try {
      convergence = await findConvergence(mem, observation, listFamilyIds(), getObservation);
    } catch (err) {
      console.error("Mem0 lookup failed:", err);
    }
  }
  res.status(201).json({ observation, convergence });
}

// Returns themes reported by 2+ distinct families, with verbatim quotes and a drafted questionnaire question.
async function handleClusters(_req: Request, res: Response<ClustersResponse | ErrorBody>): Promise<void> {
  if (!mem) {
    res.status(503).json({ error: "Mem0 is not configured — set MEM0_API_KEY in .env" });
    return;
  }
  try {
    res.json({ clusters: await buildClusters(mem, listFamilyIds(), getObservation) });
  } catch (err) {
    console.error("Cluster search failed:", err);
    res.status(502).json({ error: "Mem0 search failed" });
  }
}

app.get("/api/observations", handleList);
app.post("/api/observations", handleCreate);
app.get("/api/clusters", handleClusters);
app.use(express.static(publicDir));

const seeded = loadSeeds();
console.log(`Loaded ${seeded} seed observations`);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`signalsense listening on http://localhost:${port}`);
  void syncSeedsToMem0();
});

// Pushes seeded observations into Mem0 in the background, skipping ones already synced.
async function syncSeedsToMem0(): Promise<void> {
  if (!mem) {
    console.warn("MEM0_API_KEY not set — convergence and /api/clusters are disabled");
    return;
  }
  try {
    const { added, skipped } = await syncObservations(mem, listObservations());
    console.log(`Mem0 sync: ${added} added, ${skipped} already synced`);
  } catch (err) {
    console.error("Mem0 sync failed:", err);
  }
}
