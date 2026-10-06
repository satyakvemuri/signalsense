// A functional domain Mem0 tags each observation with; "watched" ones are the themes the platform surfaces.
export interface Category {
  id: string;
  label: string; // dashboard name, e.g. "Fine motor changes"
  area: string; // short descriptor shown above the name, e.g. "Fine motor · hands"
  description: string;
  watched: boolean;
}

export const CATEGORIES: Category[] = [
  {
    id: "fine_motor",
    label: "Fine motor changes",
    area: "Fine motor · hands",
    description:
      "difficulty with hand dexterity or small precise movements: buttons, zippers, jar lids, sewing, handwriting, grip, dropping things",
    watched: true,
  },
  { id: "sleep", label: "Sleep disruption", area: "Sleep · nights", description: "sleep problems, waking at night, insomnia, daytime drowsiness", watched: false },
  { id: "appetite", label: "Appetite changes", area: "Appetite · eating", description: "eating, appetite, food refusal, taste changes", watched: false },
  { id: "mood", label: "Mood changes", area: "Mood · emotional state", description: "mood, irritability, withdrawal, tearfulness, emotional state", watched: false },
  { id: "speech", label: "Speech changes", area: "Speech · language", description: "speech, slurring, word finding, language", watched: false },
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
  item: string; // the drafted questionnaire item (phrased as a question, never as a conclusion)
}

export const THEMES: Theme[] = [
  {
    id: "fine-motor",
    label: "difficulty with fine-motor tasks",
    categoryId: "fine_motor",
    query: "fine motor / hand dexterity difficulty with buttons, zippers, jar lids, sewing or small objects",
    item: "In the past month, has your family member had more difficulty with buttons, zippers, caps, or other small objects?",
  },
];

// Returns the category IDs the platform watches for convergence.
export function watchedCategoryIds(): string[] {
  return CATEGORIES.filter((c) => c.watched).map((c) => c.id);
}
