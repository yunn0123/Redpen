/** Store control IDs rather than DOM markup; new controls append to older saved orders. */
export const toolbarGroups = {
  drawing: ["select", "pan", "note", "cover", "crop", "arrow", "text", "stamp", "outline", "components", "new-image", "settings-open"],
  actions: ["undo", "redo", "import", "export", "toggle-sidebar"],
};
export type ToolbarOrder = { drawing: string[]; actions: string[] };
export function toolbarOrder(value: unknown): ToolbarOrder {
  const stored = value && typeof value === "object" ? value as Partial<ToolbarOrder> : {};
  const normalize = (group: keyof ToolbarOrder) => {
    const known = toolbarGroups[group];
    const saved = Array.isArray(stored[group]) ? stored[group]!.filter(id => known.includes(id)) : [];
    return [...new Set([...saved, ...known])];
  };
  return { drawing: normalize("drawing"), actions: normalize("actions") };
}
