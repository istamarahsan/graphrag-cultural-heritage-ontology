import z from "zod";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number(),
  retryMax: z.number().optional(),
  concurrency: z.number().optional()
});

// deno-lint-ignore no-explicit-any
function parse(obj: any) {
  return configSchema.parse(obj);
}

export default {
  parse,
};
