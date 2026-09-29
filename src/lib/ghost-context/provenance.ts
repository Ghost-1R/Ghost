import type { ContextItem, SourceRef } from "./types";

export function publicContext(items: ContextItem[]) {
  return items.map((item) => ({
    authority: item.authority,
    type: item.type,
    title: item.title,
    content: item.content,
    status: item.status,
    sourceId: item.sourceId,
    because: item.selectedBecause,
  }));
}

export function sourceRefs(items: ContextItem[]): SourceRef[] {
  return items.map((item) => ({
    id: item.sourceId,
    type: item.type,
    title: item.title,
    status: item.status,
  }));
}
