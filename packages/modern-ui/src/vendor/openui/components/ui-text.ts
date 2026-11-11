import { createContext, useContext } from "react";

/** Interface words inside components; the block supplies them in the reader's language. */
export const UI_TEXT = {
  diagram: "Diagram",
  selection: "Selection",
  details: "Details",
  chart: "Chart",
  chartData: "View chart data",
  chartRangeExceeded: "The stacked total is outside the chart’s numeric range. The complete data is shown below.",
  copy: "Copy",
  copied: "Copied",
  copyCode: "Copy code",
  code: "code",
  previous: "Previous",
  next: "Next",
  tapToFlip: "Tap to flip",
  choose: "Choose…",
  value: "Value",
  date: "Date",
  timer: "Timer",
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  reset: "Reset",
  interactiveView: "Interactive view",
  preparingView: "Preparing the interactive view…",
  viewStopped: "This interactive view tried to leave its sandbox and was stopped.",
  stopView: "Stop view",
  restartView: "Restart view",
  viewUnresponsive: "This interactive view stopped responding and was closed.",
  viewClosed: "Interactive view closed.",
};

export type UiText = typeof UI_TEXT;

export const UiTextContext = createContext<UiText>(UI_TEXT);

export const useUiText = (): UiText => useContext(UiTextContext);

/** Selected host language; standalone renderers retain the historical English default. */
export const UiLocaleContext = createContext<string>("en-US");
export const useUiLocale = (): string => useContext(UiLocaleContext);
