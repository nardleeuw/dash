import { z } from "zod";

export const locationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("nl") }),
  z.object({ type: z.enum(["province", "municipality", "city", "postcode"]), name: z.string().min(1).max(120), lat: z.number().min(50).max(54), lng: z.number().min(3).max(8) }),
  z.object({ type: z.literal("radius"), name: z.string().min(1).max(120), lat: z.number().min(50).max(54), lng: z.number().min(3).max(8), radiusKm: z.number().min(0.5).max(50) }),
]);

export const providerSchema = z.enum(["kvk", "google_places", "osm"]);

export const searchFiltersSchema = z.object({
  text: z.string().trim().max(120).optional(),
  industries: z.array(z.string().max(40)).max(10).default([]),
  locations: z.array(locationSchema).max(5).default([]),
  radiusKm: z.number().min(1).max(50).optional(),
  activeOnly: z.boolean().optional(),
  kvkType: z.enum(["hoofdvestiging", "nevenvestiging", "rechtspersoon"]).optional(),
  requireWebsite: z.boolean().optional(),
  requirePhone: z.boolean().optional(),
  providers: z.array(providerSchema).min(1).max(3),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const cursorsSchema = z.partialRecord(providerSchema, z.string().max(2000).nullable()).default({});

export const importGroupsSchema = z
  .array(z.object({ sources: z.array(z.object({ provider: providerSchema, externalId: z.string().min(1).max(300) })).min(1).max(5) }))
  .min(1)
  .max(500);
