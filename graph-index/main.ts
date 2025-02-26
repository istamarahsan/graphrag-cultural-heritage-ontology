import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const promptFilePath = "system.txt";
const dataFilePath = "data/chapters.json"

if (import.meta.main) {
  const promptTemplateText = await Deno.readTextFile(promptFilePath);
  const chapters = JSON.parse(await Deno.readTextFile(dataFilePath))
  const chapter = chapters[0]["subChapters"][2]
  console.log(`Selected chapter: ${chapter["subChar"]}. ${chapter["subTitle"]}`)
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", promptTemplateText],
    ["user", "{text}"],
  ]);
  const model = new ChatOllama({
    baseUrl: "http://localhost:11434",
    model: "openthinker:latest",
    temperature: 0.7,
  });
  const prompt = await promptTemplate.invoke({
    text: chapter["subText"]
  })
  const response = await model.invoke(prompt)
  for (const triple of response.content.toString().split("\n")) {
    console.log(triple)
  }
}
