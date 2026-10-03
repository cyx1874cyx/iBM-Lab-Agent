import { z } from "zod";
import { PROFILE_ID_RE } from "./identifiers.js";

export const sourceChangedSchema = z.object({
 version: z.literal(1), projectId: z.string().regex(PROFILE_ID_RE), bundleId: z.string().regex(PROFILE_ID_RE),
 kind: z.enum(["pdf", "si"]), previousSha256: z.string().optional(), sha256: z.string().regex(/^[0-9a-f]{64}$/)
});
