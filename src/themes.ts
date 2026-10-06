// A functional domain Mem0 tags each observation with; "watched" ones are the themes the platform surfaces.
export interface Category {
  id: string;
  description: string;
  watched: boolean;
}

export const CATEGORIES: Category[] = [
  {
    id: "fine_motor",
    description:
      "difficulty with hand dexterity or small precise movements: buttons, zippers, jar lids, sewing, handwriting, grip, dropping things",
    watched: true,
  },
  { id: "sleep", description: "sleep problems, waking at night, insomnia, daytime drowsiness", watched: false },
  { id: "appetite", description: "eating, appetite, food refusal, taste changes", watched: false },
  { id: "mood", description: "mood, irritability, withdrawal, tearfulness, emotional state", watched: false },
  { id: "speech", description: "speech, slurring, word finding, language", watched: false },
];

// Per-call instruction that makes Mem0 name the functional domain in every stored memory, so
// differently worded reports of the same thing land close together (plain similarity can't bridge them).
export const ENRICH_INSTRUCTIONS =
  "Store the observation as one short third-person sentence that keeps the original details AND names the functional domain in plain words " +
  "(e.g. 'fine motor / hand dexterity difficulty', 'sleep disturbance', 'appetite change', 'mood change', 'speech difficulty'). Do not interpret or diagnose.";

// A watched theme: what to search for, which category it lives in, and how to name it in questions.
export interface Theme {
  id: string;
  label: string;
  categoryId: string;
  query: string;
}

export const THEMES: Theme[] = [
  {
    id: "fine-motor",
    label: "difficulty with fine-motor tasks",
    categoryId: "fine_motor",
    query: "fine motor / hand dexterity difficulty with buttons, zippers, jar lids, sewing or small objects",
  },
];

// Returns the category IDs the platform watches for convergence.
export function watchedCategoryIds(): string[] {
  return CATEGORIES.filter((c) => c.watched).map((c) => c.id);
}
