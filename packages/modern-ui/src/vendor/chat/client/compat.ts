/**
 * Modern's chat components are typed against the vendored rc.3 contract (its own ChatSnapshot and
 * process presentation), while the Slot registry types them against the official rc.4
 * declarations that the official ui-tool types pull into the program. The shapes agree at runtime;
 * this erases the nominal mismatch at the registration boundary only.
 * @param component - a vendored Slot or Factory component.
 * @returns the same component, typed as whatever the registration expects.
 */
export const compat = <C,>(component: C): never => component as unknown as never
