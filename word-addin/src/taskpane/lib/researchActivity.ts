/** User-facing label for a legal-research tool call in the Word pane. */
export function researchActivityLabel(toolName: string): string | null {
  if (toolName.startsWith("au_search_legislation") || toolName.startsWith("au_get_legislation") || toolName.startsWith("au_legislation") || toolName.startsWith("au_find_in_legislation")) {
    return "Commonwealth legislation";
  }
  if (toolName.startsWith("au_search_vic") || toolName.startsWith("au_get_vic") || toolName.startsWith("au_vic_") || toolName.startsWith("au_find_in_vic")) {
    return "Victorian legislation";
  }
  if (toolName.startsWith("au_search_energy") || toolName.startsWith("au_get_energy") || toolName.startsWith("au_energy") || toolName.startsWith("au_find_in_energy")) {
    return "Australian energy law";
  }
  if (toolName.startsWith("au_search_case") || toolName.startsWith("au_get_case") || toolName.startsWith("au_find_in_case")) {
    return "Australian case law";
  }
  if (toolName.startsWith("courtlistener_")) return "US case law";
  return null;
}
