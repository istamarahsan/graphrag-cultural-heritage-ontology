// deno-lint-ignore-file no-explicit-any
import z from "zod";
import { Eta } from "eta";
import OpenAI from "@openai/openai";
import _ from "lodash";
import Config from "./config.ts";

const museumNasionalScrapedPage = z.object({
  url: z.string().url(),
  title: z.string(),
  date: z.string().datetime({ offset: true }),
  content: z.string(),
  type: z.enum(["news", "collection", "publication"]),
});

type MuseumNasionalScrapedPage = z.infer<typeof museumNasionalScrapedPage>;

const multipleChoiceQuestionSchema = z
  .object({
    question: z.string().min(1, { message: "Question text cannot be empty" }),
    choices: z
      .array(z.string().min(1, { message: "Choice text cannot be empty" }))
      .min(2, { message: "Must provide at least two choices" }), // Usually at least A and B
    // Ensures answerIdx is an integer, non-negative, and within the bounds of the choices array
    answerIdx: z
      .number()
      .int({ message: "answerIdx must be an integer" })
      .nonnegative({ message: "answerIdx cannot be negative" }),
  })
  .refine(
    // Custom refinement to check if answerIdx is a valid index for the choices array
    (data) => data.answerIdx < data.choices.length,
    {
      message: "answerIdx must be less than the number of choices provided",
      path: ["answerIdx"], // Specify the path of the error
    },
  );

type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>;

async function main() {
  const config = await Deno.readTextFile("config.json")
    .then(JSON.parse)
    .then(Config.parse);
  Deno.mkdir("out/", { recursive: true });
  const outFilePrefix = `out/${new Date().toISOString().replaceAll(":", ".")}`;

  const allData = await loadAndValidateData(
    "data/museum_nasional_scraped.json",
  ); // Load and validate input JSON

  const museumData: {
    id: string;
    metadata: { subcategory: string; url: string; type: string; title: string };
    content: string;
  }[] | null = await Deno.readTextFile("./data/museum.json")
    .then(JSON.parse)
    .catch(() => {
      return null;
    }); // We need to trim the data for now

  const collectionEntries = allData.filter(
    (entry) => // entry.type === "collection" &&
    (museumData === null ||
      museumData.find((m) => m.metadata.url === entry.url)),
  );

  if (collectionEntries.length === 0) {
    console.log('No entries with type "collection" found in the data file.');
    return;
  }

  const openai = new OpenAI({
    baseURL: config.endpoint,
    apiKey: config.apiKey ?? "",
  });
  const promptTemplate = new Eta({ views: "./" });

  const entryChunks = _.chunk(shuffleArray(collectionEntries), 5);

  // Generate and validate multiple-choice questions
  for (const chunk of entryChunks) {
    for (let i = 0; i < 10; i++) {
      const generatedQuestions =
        await generateMultipleChoiceQuestionsFromCollectionPage(
          openai,
          promptTemplate,
          {
            chunks: chunk,
            nQuestions: 10,
            model: config.model,
            temperature: config.temperature,
          },
        );

      if (!generatedQuestions) {
        console.log(
          `\nFailed at try #${i}`,
        );
        continue;
      }

      console.log(
        `\n--- Generated & Validated Questions for "chunks" ---`,
      );
      // Output the validated data
      Deno.writeTextFile(
        `${outFilePrefix}.jsonl`,
        JSON.stringify({
          page: {
            // title: entry.title,
            // url: entry.url,
          },
          data: generatedQuestions,
        }, null, 4) + "\n",
        {
          append: true,
          create: true,
        },
      );
      break;
    }
  }
}

async function loadAndValidateData(
  filePath: string,
): Promise<MuseumNasionalScrapedPage[]> {
  try {
    const fileContent = await Deno.readTextFile(filePath);
    const jsonData = JSON.parse(fileContent);
    const validationResult = z
      .array(museumNasionalScrapedPage)
      .safeParse(jsonData); // Validates input data
    if (!validationResult.success) {
      console.error("Input data validation failed (scraped.json):");
      validationResult.error.errors.forEach((err) => {
        console.error(` Path: ${err.path.join(".")} -> ${err.message}`);
      });
      throw new Error("Invalid data format in scraped.json");
    }
    console.log("Museum input data loaded and validated successfully.");
    return validationResult.data;
  } catch (error: any) {
    console.error(
      `Error reading or parsing museum data file (${filePath}): ${error.message}`,
    );
    throw error;
  }
}

function shuffleArray<T>(array: T[]): T[] {
  // Create a copy of the original array to avoid mutating it
  const shuffledArray = [...array];

  // Start from the last element and swap one by one. We don't need to run for the first element
  for (let i = shuffledArray.length - 1; i > 0; i--) {
      // Generate a random index between 0 and i
      const j = Math.floor(Math.random() * (i + 1));

      // Swap shuffledArray[i] with the element at the random index
      [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
  }

  return shuffledArray;
}

function extractJsonContent(
  jsonString: string,
  type: "array" | "object" = "array",
): string {
  // Determine the start and end characters based on the type
  const startChar = type === "array" ? "[" : "{";
  const endChar = type === "array" ? "]" : "}";

  const startIndex = jsonString.indexOf(startChar);
  if (startIndex === -1) return "";

  let depth = 0;
  let endIndex = -1;

  for (let i = startIndex; i < jsonString.length; i++) {
    const char = jsonString[i];
    if (char === startChar) {
      depth++;
    } else if (char === endChar) {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  return jsonString.substring(startIndex, endIndex + 1);
}

async function generateMultipleChoiceQuestionsFromCollectionPage(
  openai: OpenAI,
  promptTemplate: Eta,
  {
    chunks,
    nQuestions,
    model,
    temperature = 1,
  }: {
    chunks: any;
    nQuestions: number;
    model: string;
    temperature?: number;
  },
): Promise<MultipleChoiceQuestion[] | null> {
  try {
    // 1. Prepare data for the template
    const templateData = {
      content: JSON.stringify(
        chunks.map((c: { title: any; subcategory: any; content: any }) => ({
          title: c.title,
          category: c.subcategory,
          description: c.content,
        })),
      ),
      nQuestions,
      numPairs: nQuestions,
    };

    // 2. Render the prompt using the template engine (EJS example)
    console.log(`Rendering prompt template`);
    const prompt = promptTemplate.render("./prompt-multiple", templateData);

    // 3. Call OpenAI API
    console.log(`Calling OpenAI model: ${model}...`);
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          // System prompt tailored for Indonesian MCQ JSON output
          content:
            "Anda adalah asisten AI yang bertugas membuat soal pilihan ganda dari teks yang diberikan. Hasil harus berupa JSON array sesuai format yang diminta tanpa teks tambahan.",
        },
        { role: "user", content: prompt },
      ],
      temperature,
    });

    const responseContent = completion.choices[0]?.message?.content;

    if (!responseContent) {
      console.error("OpenAI API returned empty content.");
      return null;
    }

    // const ai_json_completion = await openai.chat.completions.create({
    //   model,
    //   messages: [
    //     {role: "system", content: "Anda adalah asisten AI yang bertugas untuk membantu pengguna dalam berbagai hal, pastikan anda melakukan yang terbaik dan sesuai dengan permintaan pengguna."},
    //     {role: "user", content: `Tanpa teks tambahan atau kalimat lain, hanya teks JSON, bantu perbaiki format JSON berikut menjadi bentuk JSON yang benar:\n${responseContent}`}
    //   ],
    //   temperature,
    // });

    // 4. Parse the JSON response string
    let parsedJson: any;
    try {
      parsedJson = JSON.parse(parseLLMResponse(responseContent));
    } catch (parseError: any) {
      console.error(
        `Failed to parse OpenAI response as JSON. Error: ${parseError.message}`,
      );
      console.error("Raw Response Content:", responseContent);
      return null; // Can't validate if it's not valid JSON
    }

    // 5. Validate the parsed JSON against the NEW Zod schema
    console.log("Validating JSON structure against schema...");
    const validationResult = z
      .array(multipleChoiceQuestionSchema)
      .safeParse(parsedJson);

    if (!validationResult.success) {
      console.error(
        "Validation Failed: OpenAI response JSON does not match the expected format.",
      );
      // Log detailed Zod errors
      validationResult.error.errors.forEach((err) => {
        console.error(`  Path: ${err.path.join(".")} -> ${err.message}`);
      });
      console.error(
        "Parsed JSON that failed validation:",
        JSON.stringify(parsedJson, null, 2),
      ); // Log the invalid structure
      return null;
    }

    // 6. Return the validated data
    console.log(
      "Successfully generated and validated multiple-choice questions.",
    );
    return validationResult.data; // Return the structured, validated data
  } catch (error: any) {
    console.error(`An unexpected error occurred: ${error.message}`);
    console.error(error.stack); // Log stack trace for other errors
  }
  return null;
}

function parseLLMResponse(responseStr: string): string {
  // return _.trim(
  //   responseStr
  //     .split("json")
  //     .filter((it) => it !== "")
  //     .join(""),
  //   "`\n ",
  // );
  return _.trim(extractJsonContent(responseStr, 'array'));
}

if (import.meta.main) {
  main();
}
