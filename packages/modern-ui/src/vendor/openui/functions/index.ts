import { dateFunctions } from "./dates";
import { listFunctions } from "./lists";
import { numberFunctions } from "./numbers";
import { textFunctions } from "./text";

// Upstream helpers for consumer answers (bill splits, loans, cooking units, games) that a coding
// agent's blocks rarely need; leaving them out keeps the prompt shorter.
const OMITTED = new Set(["Pick", "Shuffle", "Chunk", "Flatten", "Lerp", "Allocate", "Payment", "Convert", "Pad", "Capitalize", "Now", "StartOf", "MonthsBetween"]);

/**
 * Generic functions the model calls as @Name(args) to compute inside a block:
 * edit lists held in $variables, do the math, and format text and dates. They
 * are pure except @Random. Bad arguments, or a throw, make a call evaluate to
 * null. The upstream dashboard (Query rows) and color functions are left out:
 * DSH blocks have no data tools.
 */
export const functions = [...listFunctions, ...numberFunctions, ...textFunctions, ...dateFunctions].filter((fn) => !OMITTED.has(fn.name));
