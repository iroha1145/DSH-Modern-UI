import { isReactiveAssign, useFormName, useGetFieldValue, useStateField } from "@openuidev/react-lang";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { flushSync } from "react-dom";

type Entry = { form: string | undefined; label: string; read: () => unknown };

/**
 * Every input's label and a reader of its shown value, grouped by the Form it sits in. The renderer's own
 * state holds only values a reader changed (a literal default is shown but never stored), and a named Form's
 * state leaves out $variables, so a @ToAssistant click reads what the reader sees from here instead. Values
 * are read when the click's step runs: an earlier @Set in the same Action is included, a later @Reset is not.
 */
export class FieldRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Set once a @ToAssistant reads the fields: controls mounting from then on need not wait to settle. */
  settled = false;

  set(key: string, entry: Entry): void {
    this.entries.set(key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * The current values of one Form's inputs, or of the inputs outside any Form, in mount order. Called from an
   * action step, outside rendering: it first renders what earlier steps changed, so controls that normalise
   * their value under new props (a slider whose bound an @Set narrowed, a Select whose options lost its value)
   * have stored the value they show before it is read.
   * @param form - The Form name of the clicked button, if any.
   * @returns Label and value pairs.
   */
  read(form: string | undefined): [string, unknown][] {
    this.settled = true;
    flushSync(() => {});
    return [...this.entries.values()].filter((entry) => entry.form === form).map((entry) => [entry.label, entry.read()]);
  }
}

export const FieldRegistryContext = createContext<FieldRegistry | null>(null);

/**
 * The state key of a control: its statement name, or an id of this instance. Never the label, so two inputs
 * that share a label keep their own values; inputs bound to one $variable share it through the binding.
 */
export function useFieldName(statementId?: string) {
  const id = useId();
  return statementId || id;
}

/**
 * useStateField that also records the control's label and how to read its value for @ToAssistant.
 * @param label - The control's visible label, if any.
 * @param statementId - The statement that defines the control.
 * @param value - The authored value: a literal default or a $variable binding.
 * @returns The state field.
 */
export function useField<T>(label: unknown, statementId: string | undefined, value: T) {
  const name = useFieldName(statementId);
  const field = useStateField(name, value);
  const form = useFormName();
  const getFieldValue = useGetFieldValue();
  const registry = useContext(FieldRegistryContext);
  const key = useId();
  const shownLabel = (typeof label === "string" && label) || statementId || "value";
  // The reader resolves the latest props the way useStateField does, against the store as it is at the click.
  const live = useRef({ name, value });
  live.current = { name, value };
  useEffect(() => {
    const read = () => {
      const current = live.current.value;
      return isReactiveAssign(current) ? getFieldValue(undefined, current.target) : (getFieldValue(form, live.current.name) ?? current);
    };
    registry?.set(key, { form, label: shownLabel, read });
  }, [registry, key, form, shownLabel, getFieldValue]);
  useEffect(() => () => registry?.delete(key), [registry, key]);
  return field;
}
