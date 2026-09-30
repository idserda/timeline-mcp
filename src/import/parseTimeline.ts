export type ParsedTimelineDocument = {
  semanticSegments: Array<Record<string, unknown>>;
};

export function parseTimelineDocument(input: string): ParsedTimelineDocument {
  const parsed = JSON.parse(input) as { semanticSegments?: Array<Record<string, unknown>> };

  return {
    semanticSegments: parsed.semanticSegments ?? []
  };
}

export function parseLatLng(value: string | undefined): { lat: number | null; lng: number | null } {
  if (!value) {
    return { lat: null, lng: null };
  }

  const match = value.match(/([\d.-]+)°,\s*([\d.-]+)°/);

  if (!match) {
    return { lat: null, lng: null };
  }

  return { lat: Number(match[1]), lng: Number(match[2]) };
}
