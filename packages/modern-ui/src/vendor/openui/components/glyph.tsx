import * as lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Every export that is one of the icons, so names such as "check-circle" resolve through lucide's
// own aliases while helpers like Icon or createLucideIcon never do.
const ICONS = new Set<unknown>(Object.values(lucide.icons));
const exported = lucide as unknown as Record<string, unknown>;

/** "MapPin", "map_pin" and "map pin" all mean the lucide icon "map-pin" (component MapPin). */
function iconFor(value: unknown): LucideIcon | null {
  if (typeof value !== "string") return null;
  const pascal = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");
  const icon = Object.hasOwn(exported, pascal) ? exported[pascal] : undefined;
  return ICONS.has(icon) ? (icon as LucideIcon) : null;
}

/** A lucide icon. Unknown names render nothing. */
export function Glyph({ name, size = 18, className }: { name: unknown; size?: number; className?: string }) {
  const Icon = iconFor(name);
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={1.8} aria-hidden className={className} />;
}
