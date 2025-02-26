import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import _ from "lodash";

const promptFilePath = "data/system.txt";
const dataFilePath = "data/chapters.json";
const outFilePath = "out/graph.csv";

if (import.meta.main) {
  try {
    await Deno.remove(outFilePath, { recursive: true });
  } catch (_error) {
    // file does not exist
  }
  const promptTemplateText = await Deno.readTextFile(promptFilePath);
  const chapters = JSON.parse(await Deno.readTextFile(dataFilePath));
  for (const chapter of (chapters as any[]).flatMap(chapter => chapter["subChapters"])) {
    console.log(
      `Selected chapter: ${chapter["subChar"]}. ${chapter["subTitle"]}`,
    );
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", promptTemplateText],
      ["user", "{text}"],
    ]);
    const model = new ChatOllama({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5",
      temperature: 0.7,
    });
    const textChunks = chunkStringWithOverlap(chapter["subText"], 2500, 500);
    for (const chunk of textChunks) {
      const prompt = await promptTemplate.invoke({
        text: chunk,
      });
      console.log("Prompt: " + prompt.messages.at(-1)?.content);
  
      const response = await model.invoke(prompt);
      const triples = response.content.toString().split("\n");
  
      for (const triple of triples) {
        console.log(triple);
      }
      console.log("");
  
      await Deno.mkdir("out", { recursive: true });
      await Deno.writeTextFile(
        outFilePath,
        triples.map((triple) => _.trim(triple, "()")).join("\n").concat("\n"),
        { append: true },
      );
    }
  }
}

function chunkStringWithOverlap(
  str: string,
  chunkSize: number,
  overlap: number,
) {
  const result = [];
  const charArray = str.split("");
  for (let i = 0; i <= charArray.length - chunkSize; i += chunkSize - overlap) {
    result.push(charArray.slice(i, i + chunkSize).join(""));
  }
  return result;
}
