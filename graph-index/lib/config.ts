import z from "zod";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number(),
  chunking: z
    .object({
      maxCharLength: z.number(),
      minSentences: z.number(),
      maxSentences: z.number(),
      sentenceOverlap: z.number(),
    })
    .optional(),
  retryMax: z.number().optional(),
});

// deno-lint-ignore no-explicit-any
function parse(obj: any) {
  return configSchema.parse(obj);
}

export default {
  parse,
};
