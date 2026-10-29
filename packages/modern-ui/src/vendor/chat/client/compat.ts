/** Retain the component's actual props so public slot registrations check their contracts. */
export const compat = <C,>(component: C): C => component
