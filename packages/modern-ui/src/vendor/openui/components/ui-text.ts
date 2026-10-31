import { createContext, useContext } from "react";

/** Interface words inside components; the block supplies them in the reader's language. */
export const UI_TEXT = {
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
};

export type UiText = typeof UI_TEXT;

export const UiTextContext = createContext<UiText>(UI_TEXT);

export const useUiText = (): UiText => useContext(UiTextContext);
