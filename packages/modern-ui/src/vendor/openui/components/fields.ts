import { useFormName, useStateField } from "@openuidev/react-lang";
import { createContext, useContext, useEffect, useId } from "react";

type Entry = { form: string | undefined; label: string; value: unknown };

/**
 * Every input's label and shown value, grouped by the Form it sits in. The renderer's own state holds
 * only values a reader changed (a literal default is shown but never stored), and a named Form's state
 * leaves out $variables, so a @ToAssistant click reads what the reader sees from here instead.
 */
export class FieldRegistry {
  private readonly entries = new Map<string, Entry>();

  set(key: string, entry: Entry): void {
    this.entries.set(key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * The shown values of one Form's inputs, or of the inputs outside any Form, in mount order.
   * @param form - The Form name of the clicked button, if any.
   * @returns Label and value pairs.
   */
  read(form: string | undefined): [string, unknown][] {
    return [...this.entries.values()].filter((entry) => entry.form === form).map((entry) => [entry.label, entry.value]);
  }
}

export const FieldRegistryContext = createContext<FieldRegistry | null>(null);

/** The state key of a control: its label, its statement name, or a generated id. */
export function useFieldName(label: unknown, statementId?: string) {
  const id = useId();
  return (typeof label === "string" && label) || statementId || id;
}

/**
 * useStateField that also records the control's label and shown value for @ToAssistant.
 * @param label - The control's visible label, if any.
 * @param statementId - The statement that defines the control.
 * @param value - The authored value: a literal default or a $variable binding.
 * @returns The state field.
 */
export function useField<T>(label: unknown, statementId: string | undefined, value: T) {
  const name = useFieldName(label, statementId);
  const field = useStateField(name, value);
  const form = useFormName();
  const registry = useContext(FieldRegistryContext);
  const key = useId();
  const shownLabel = (typeof label === "string" && label) || statementId || "value";
  useEffect(() => {
    registry?.set(key, { form, label: shownLabel, value: field.value });
  }, [registry, key, form, shownLabel, field.value]);
  useEffect(() => () => registry?.delete(key), [registry, key]);
  return field;
}
