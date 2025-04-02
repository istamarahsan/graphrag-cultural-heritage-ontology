import OpenAI from "@openai/openai";
import z from "zod";
import _ from "lodash";
import { error, ok, Result } from "./result.ts";

// --- Common Types ---

export type LLMClient = {
  openai: OpenAI;
  model: string;
  temperature: number;
};

export type FewShotExample = {
  prompt: string; // User message content for the example
  response: string; // Assistant message content (expected JSON string)
};

export type BaseExtractOptions = {
  fewShotExamples?: FewShotExample[];
};

// --- Ontology-Assisted Extraction Types ---

export const entitySchema = z.object({
  class: z.string().describe("Ontology class ID (e.g., E22_Human-Made_Object)"),
  name: z.string().describe("Name or identifier of the entity instance"),
});
export const ontologyTripletSchema = z.object({
  domain: entitySchema,
  property: z.string().describe(
    "Ontology property ID (e.g., P108i_was_produced_by)",
  ),
  range: entitySchema,
});

export type Entity = z.infer<typeof entitySchema>;
export type OntologyTriplet = z.infer<typeof ontologyTripletSchema>;

export type ExtractOntologyTripletsOptions = BaseExtractOptions & {
  systemPrompt: string; // Base system prompt (should indicate where ontology goes)
  ontologyDescription: string; // The actual ontology description text
};

// --- Ontology-Free Extraction Types ---

export const simpleTripletSchema = z.object({
  subject: z.string().describe("Name of the subject entity"),
  predicate: z.string().describe(
    "Natural language phrase describing the relationship",
  ),
  object: z.string().describe("Name of the object entity or its literal value"),
});

export type SimpleTriplet = z.infer<typeof simpleTripletSchema>;

export type ExtractSimpleTripletsOptions = BaseExtractOptions & {
  systemPrompt: string; // System prompt for simple extraction
};

export type LLMRawResponse = { content: string; reasoning?: string };

export type ExtractionError =
  & { message: string }
  & ({ type: "InferenceError" } | {
    type: "ParseError";
    rawResponse: LLMRawResponse;
  });
type ExtractionResult<T> = Result<
  { parsed: T; rawResponse: LLMRawResponse },
  ExtractionError
>;

export type TripletExtractionResult<Triplet = object> = Result<
  { triplets: Triplet[]; rawResponse: LLMRawResponse },
  ExtractionError
>;
export type OntologyExtractionResult = TripletExtractionResult<OntologyTriplet>;
export type SimpleExtractionResult = TripletExtractionResult<SimpleTriplet>;

// --- Core Extraction Logic ---

/**
 * Generic function to interact with LLM for extraction, handling retries and validation.
 */
async function _extractWithLLM<T>(
  client: LLMClient,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  parse: (obj: object) => T,
): Promise<
  ExtractionResult<T>
> {
  try {
    const rawResponse = await _rawPrompt(client, {
      model: client.model,
      temperature: client.temperature,
      messages: messages,
    });
    try {
      const cleanedJsonString = _parseLLMResponse(rawResponse.content);
      const json = JSON.parse(cleanedJsonString);
      const validatedResult = parse(json);
      return ok({ parsed: validatedResult, rawResponse });
    } catch (err) {
      return error({
        type: "ParseError",
        rawResponse,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    return error({
      type: "InferenceError",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Function to handle the actual OpenAI API call and logging.
 */
async function _rawPrompt(
  client: LLMClient,
  {
    messages,
    model,
    temperature,
  }: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    model: string;
    temperature: number;
  },
): Promise<LLMRawResponse> {
  const response = await client.openai.chat.completions.create({
    messages,
    model,
    temperature,
    stream: false,
  });
  return z.object({
    content: z.string(),
    reasoning: z.string().optional(),
  }).parse(response.choices[0]?.message);
}

function _parseLLMResponse(responseStr: string): string {
  return _.trim(
    (responseStr.includes("</think>")
      ? responseStr.split("</think>")[1]
      : responseStr)
      .split("json")
      .filter((it) => it !== "")
      .join(""),
    "`\n ",
  );
}

// --- Public API Functions ---

export type TripletExtractionResults<Triplet> = Result<Triplet[], Error>[];

/**
 * Extracts structured triplets from text based on a provided ontology description.
 */
export async function extractOntologyTriplets(
  client: LLMClient,
  text: string,
  {
    systemPrompt: baseSystemPrompt, // Renamed for clarity
    ontologyDescription,
    fewShotExamples = [],
  }: ExtractOntologyTripletsOptions,
): Promise<
  OntologyExtractionResult
> {
  const fullSystemPrompt = `${baseSystemPrompt}\n\n${ontologyDescription}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: fullSystemPrompt,
    },
    // Flatten few-shot examples into the message array
    ...fewShotExamples.flatMap<
      OpenAI.Chat.Completions.ChatCompletionMessageParam
    >(({ prompt, response }) => [{
      role: "user",
      content: prompt,
    }, {
      role: "assistant",
      content: response, // Expects JSON string here
    }]),
    // Add the actual text to extract from
    {
      role: "user",
      content: text,
    },
  ];

  const expectedSchema = z.array(ontologyTripletSchema);

  const result = await _extractWithLLM(
    client,
    messages,
    expectedSchema.parse,
  );
  if (result.ok) {
    return ok(
      { triplets: result.value.parsed, rawResponse: result.value.rawResponse },
    );
  }
  return result;
}

/**
 * Extracts simple (subject, predicate, object) string triplets from text
 * without reference to a specific ontology.
 */
export async function extractSimpleTriplets(
  client: LLMClient,
  text: string,
  { systemPrompt, fewShotExamples = [] }: ExtractSimpleTripletsOptions,
): Promise<SimpleExtractionResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt, // Use the ontology-free system prompt directly
    },
    // Flatten few-shot examples
    ...fewShotExamples.flatMap<
      OpenAI.Chat.Completions.ChatCompletionMessageParam
    >(({ prompt, response }) => [{
      role: "user",
      content: prompt,
    }, {
      role: "assistant",
      content: response, // Expects JSON string here
    }]),
    // Add the actual text
    {
      role: "user",
      content: text,
    },
  ];

  // Define the expected output schema for validation
  const expectedSchema = z.array(simpleTripletSchema);

  const result = await _extractWithLLM(
    client,
    messages,
    expectedSchema.parse,
  );
  if (result.ok) {
    return ok(
      { triplets: result.value.parsed, rawResponse: result.value.rawResponse },
    );
  }
  return result;
}
