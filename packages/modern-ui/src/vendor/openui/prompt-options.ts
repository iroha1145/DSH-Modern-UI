import type { PromptOptions } from "@openuidev/react-lang";

/**
 * Prompt options for DSH answers: Markdown prose with independent openui-lang blocks in fences,
 * instead of the upstream demo's whole-response program. The rules keep the upstream guidance on
 * composition and working tools that applies to a coding agent's answers.
 */

const PREAMBLE = `Rich components in this DSH web interface (users may call them OpenUI, openui or 可视化):
- Besides Markdown, an answer can contain blocks of openui-lang, a declarative UI language. A block is a fenced code block whose language is openui-lang. The interface renders it as live UI inside the answer, progressively while it streams, in the chat's own font and colors.
- Each block is a complete, independent program: its first line is root = Col(...), and its names and $variables belong to that block only. Write each block once; keep it under about 6 KB.
- Prefer showing to telling. In substantive answers (explanations, analyses, comparisons, recommendations, plans, research summaries, popular science), reach for a block whenever the content has a shape a reader takes in faster by looking: options, comparisons, architectures or processes, mechanisms, steps or timelines, key numbers and trends, tables, real things with a recognizable look, or a quantity worth adjusting in a small working tool. A long answer can carry a block for each of its parts; keep the reasoning and conclusions in the Markdown around them.
- Keep simple facts, short replies, code, commands, file contents and writing as plain Markdown, and respect requests for text only.- This description is complete: do not read DSH source code to learn the format, and do not create files, scripts, previews, screenshots or tests for it.`;

const exampleDiagram = `root = Col([diagram])
diagram = Flow([client, a1, gateway, a2, cluster, a3, db], "Request path")
client = FlowNode("Browser", "Sends the chat request", "monitor")
a1 = FlowArrow("HTTPS")
gateway = FlowNode("API gateway", "Auth and rate limits", "shield-check", "info")
a2 = FlowArrow()
cluster = FlowGroup("Kubernetes cluster", [FlowRow([FlowNode("Chat service", "Streams answers", "message-square"), FlowNode("Tool runner", "Sandboxed jobs", "box")])])
a3 = FlowArrow("SQL")
db = FlowNode("Postgres", "Primary and one replica", "database")`;

const exampleOptions = `root = Col([Title("Choosing a queue", "md"), Grid([kafka, rabbit, sqs], 3, 200, 3)])
kafka = Card([Row([Icon("activity"), Title("Kafka", "sm")], 2), Text("A replayable event log for high throughput.", "sm"), Row([Badge("Ordered per partition", "info"), Badge("Heavy to operate", "warning")], 1, null, null, true)])
rabbit = Card([Row([Icon("git-branch"), Title("RabbitMQ", "sm")], 2), Text("Flexible routing for task queues.", "sm"), Row([Badge("Rich routing", "info"), Badge("No replay", "warning")], 1, null, null, true)])
sqs = Card([Row([Icon("cloud"), Title("SQS", "sm")], 2), Text("Managed queue with nothing to run.", "sm"), Row([Badge("Zero ops", "success"), Badge("AWS only", "warning")], 1, null, null, true)])`;

const exampleTool = `root = Col([card])
card = Card([title, Grid([users, size], 2, 200, 4), stats, chart])
$users = 20000
$kb = 40
title = Title("Monthly storage estimate", "md")
users = Slider($users, 1000, 100000, 1000, "Daily active users")
size = Slider($kb, 5, 200, 5, "Data per user per day", " KB")
gb = $users * $kb * 30 / 1000000
stats = Row([Col([Caption("Per month"), Title(@Format(gb, "number", 1) + " GB", "xl")], 1), Spacer(), Col([Caption("Per year"), Title(@Format(gb * 12, "number", 0) + " GB", "xl")], 1)])
chart = Chart("bar", @Each(@Range(1, 7), "m", {month: "M" + m, gb: @Round(gb * m, 1)}), "month", ["gb"])`;

/**
 * Replaces the upstream statement order, which puts every data value last: in an answer block that leaves each
 * section empty until the whole block has streamed. scripts/generate-openui-prompt.mjs swaps it in.
 */
export const streamingOrder = `**Recommended statement order for optimal streaming:** write a block section by section, so each part is finished while the next one streams.
1. \`root = Col(...)\` — UI shell appears immediately
2. $variable declarations — state ready for bindings
3. Then each child of root in reading order: its component, followed right away by the rows, points, items and texts it alone uses. Data several parts share goes just before the first part that uses it.

Do not save all data values for the end: a section whose data comes last stays empty until the whole block has arrived.`;

/** Worked examples, checked against the library by scripts/generate-openui-prompt.mjs. */
export const examples: Record<string, string> = { exampleDiagram, exampleOptions, exampleTool };

const rules = [
  "Inside a block, compose like a small page: a Title when the block needs a heading, a short Text only if needed, then the parts that show the content. Use Card only to group a block. Keep cards compact: Title \"md\" or \"sm\", Text \"sm\", facts as Badges or label and value rows (Caption, Spacer, Text). Cards side by side in a Grid share the same parts in the same order, so they line up.",
  "Leave gap unset on the root Col and inside cards: the interface applies its spacing tiers. Set a gap only on a Row or Grid.",
  "Pick the medium that shows the idea: Flow for architectures, request paths, pipelines and processes; Table for comparisons across several attributes; Chart for numbers across time or categories; List with numbers or a timeline for ordered steps; Svg drawings for geometry, layouts and mechanisms; HtmlView only for a game or animation that needs a loop.",
  "In a Flow, every FlowNode has a short title and at most one short detail line; join rows with FlowArrow and name the call, data or condition on the arrow; put parallel nodes in a FlowRow and a host, container or trust zone in a FlowGroup.",
  "Make a block a working tool when the request involves numbers, choices, lists or steps to explore (an estimate, a sizing calculator, a checklist, a step-through): keep inputs and lists in $variables, compute everything shown from them with expressions and @functions, and change them with @Set. It must work without another message.",
  "Use @ToAssistant only for what the block cannot compute: a Form's submit Button, or a follow-up request. The interface puts its message in the reader's message box to review and send, with the form values appended, so keep it short and first person, like the user typing it, and never repeat the values in it.",
  "$variable defaults are literals (numbers, strings, lists, objects), never expressions or @calls. Edit lists with @Append, @Remove, @RemoveAt and @Update; track selections with @Toggle and @Includes.",
  "cond ? a : b also picks between components; there is no @If. Use only the listed @functions; you cannot define your own.",
  "Derive rows once in a statement with @Each(list, \"x\", {...}), then reuse them in @Each, Table, Chart, @Sum(rows.field) and @Join. @Each(@Range(0, n), \"i\", ...) builds a series.",
  "@Random gives a new value on every evaluation: call it inside @Set, so a click draws once and the block stays still.",
  "Format money, percentages and big numbers with @Format, counts with @Plural and dates with @FormatDate. Read a number input through @Default and @Clamp with a sensible minimum, so 0 or empty cannot zero out the block.",
  "Write the visible text in the user's language. Clearly label illustrative or simulated numbers. Give real subjects with a recognizable look (people, places, buildings, artworks, species, products, devices, dishes) a SearchImage, for example one per option card or per stop on a route; for abstract topics and code, a Flow, Chart or Svg drawing explains better than a photo.",
  "Keep code, commands, citation markers and source links in the Markdown around a block, not inside it.",
];

/** The DSH prompt: $variables and functions, no data tools. */
export const promptOptions: PromptOptions = {
  bindings: true,
  preamble: PREAMBLE,
  additionalRules: rules,
  examples: [
    `Example 1: An architecture diagram:\n\n\`\`\`openui-lang\n${exampleDiagram}\n\`\`\``,
    `Example 2: Options compared as cards:\n\n\`\`\`openui-lang\n${exampleOptions}\n\`\`\``,
    `Example 3: A working estimate driven by sliders:\n\n\`\`\`openui-lang\n${exampleTool}\n\`\`\``,
  ],
};
