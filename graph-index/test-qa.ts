import OpenAI from "@openai/openai";
import z from "zod";
import promiseLimit from "promise-limit";
import N3 from "n3";
import { Eta } from "eta";

import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";

import { getLocalNameFromUri } from "./lib/graph.ts";
import { RDF_BASE_URI } from "./lib/rdf.ts";
import _ from "lodash";
import path from "node:path";

const configSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string(),
  concurrency: z.number().optional().default(1),
});

type Config = z.infer<typeof configSchema>;

const promptTemplate = new Eta({ views: "./prompt" });
const renderPrompt = (data: { context?: string; question: string }) =>
  data.context
    ? promptTemplate.renderAsync("./qa", data)
    : promptTemplate.renderAsync("./qa_blank", data);

const questionChoiceLabelMap = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  "0": "A",
  "1": "B",
  "2": "C",
  "3": "D",
} as Record<string, string | number>;

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["c", "q", "t"],
    alias: { c: "config" },
    default: { c: "default.json" },
  });

  if (!args.c) {
    console.error(
      "Error: Config file path must be specified with -c or --config"
    );
    Deno.exit(1);
  }
  if (!(await exists(args.c))) {
    console.error(`Error: Config file not found at "${args.c}"`);
    Deno.exit(1);
  }

  if (!args.q) {
    console.error("Error: QA file path must be specified with -q");
    Deno.exit(1);
  }

  if (!args.t) {
    console.log("No TTL file specified, performing blank run...");
  }

  const config = await Deno.readTextFile(args.c)
    .then(JSON.parse)
    .then(configSchema.parse);
  const openai = new OpenAI({
    apiKey: config.apiKey ?? "",
    baseURL: config.endpoint,
  });

  const qaData = await Deno.readTextFile(args.q)
    .then(JSON.parse)
    .then(
      z.array(
        z.object({
          question: z.string(),
          choices: z.array(z.string()),
          answerIdx: z.number(),
        })
      ).parse
    );

  const concurrencyLimiter = promiseLimit<void>(config.concurrency);
  const answers: { raw: string; correct: boolean }[][] = [
    ...Array(qaData.length),
  ];
  const bestOf: number = 3;
  if (!args.t) {
    await Promise.all(
      qaData.map(({ question, choices, answerIdx }, i) =>
        concurrencyLimiter(async () => {
          const questionStr = `${question}\n${choices.join("\n")}\n`;
          const prompt = await renderPrompt({
            question: questionStr,
          });
          answers[i] = await Promise.all(
            [...Array(bestOf)].map(async (_e) => {
              const response = await openai.chat.completions.create({
                model: config.model,
                messages: [
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
                temperature: 1.0,
              });
              const rawResponseContent = response.choices[0].message.content!;
              return {
                raw: rawResponseContent,
                correct:
                  questionChoiceLabelMap[_.trim(rawResponseContent, ". \n")] ===
                  answerIdx,
              };
            })
          );
        })
      )
    );
  } else {
    const kgStore = await Deno.readTextFile(args.t!)
      .then((turtleStr) => new N3.Parser().parse(turtleStr))
      .then((quads) => new N3.Store(quads));
    const contextStr =
      kgStore
        .getSubjects(null, null, null)
        .map(
          (subject) =>
            `${getLocalNameFromUri(subject.id)}:\n${_.sortBy(
              kgStore.getQuads(subject, null, null, null),
              (it) => it.predicate.value
            )
              .filter(
                ({ predicate }) =>
                  predicate.value !== `${RDF_BASE_URI}hasEmbedding`
              )
              .map(
                ({ predicate, object }) =>
                  `  - ${getLocalNameFromUri(
                    predicate.value
                  )}: ${getLocalNameFromUri(object.value)}`
              )
              .join("\n")}`
        )
        .join("\n") + "\n";

    await Promise.all(
      qaData.map(({ question, choices, answerIdx }, i) =>
        concurrencyLimiter(async () => {
          const questionStr = `${question}\n${choices.join("\n")}\n`;
          const prompt = await renderPrompt({
            context: contextStr,
            question: questionStr,
          });
          answers[i] = await Promise.all(
            [...Array(bestOf)].map(async (_e) => {
              const response = await openai.chat.completions.create({
                model: config.model,
                messages: [
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
                temperature: 1.0,
              });
              const rawResponseContent = response.choices[0].message.content!;
              return {
                raw: rawResponseContent,
                correct:
                  questionChoiceLabelMap[_.trim(rawResponseContent, ". \n")] ===
                  answerIdx,
              };
            })
          );
        })
      )
    );
  }

  const qaResults = {
    summary: {
      correct: answers.filter(
        (bestOfResults) =>
          bestOfResults.filter((it) => it.correct).length >
          bestOfResults.length / 2
      ).length,
      total: qaData.length,
    },
    details: qaData.map((qa, i) => ({ ...qa, modelAnswer: answers[i] })),
  };
  const outFilePath = args.t
    ? path.join(
        path.dirname(args.t),
        path.basename(args.t, path.extname(args.t)) + "_eval.json"
      )
    : "out/eval_blank.json";
  await Deno.writeTextFile(
    outFilePath,
    JSON.stringify(qaResults, undefined, 2)
  );
}

if (import.meta.main) {
  main();
}
