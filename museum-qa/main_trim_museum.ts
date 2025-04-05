import axios from 'axios';
import { load as LoadWeb } from 'cheerio';
import { string } from "zod";

async function main() {
  const fileContent = await Deno.readTextFile('./data/museum.json');
  const dataContent = await Deno.readTextFile('./data/museum_nasional_scraped.json');

  const museumData: {
    id: string,
    metadata: {
      type: string,
      url: string,
      title: string,
    },
    content: string,
  }[] = JSON.parse(fileContent);

  const scrapedData: {
    url: string,
    subcategory?: string,
  }[] = JSON.parse(dataContent);

  let data: any[] = [];
  for (const museum of museumData) {
    const url = museum.metadata.url;
    const get = scrapedData.find((d) => d.url === url);
    const subcategory = get?.subcategory ?? "null";
    data.push({
      ...museum,
      metadata: {
        ...museum.metadata,
        subcategory,
      },
    })
  }

  data = data.filter((d) => d.metadata.subcategory !== "KOLEKSI" && d.metadata.subcategory !== "ACARA" && d.metadata.subcategory !== "BERITA" && d.metadata.subcategory !== "Keramik" && d.metadata.subcategory !== "Artikel");
  data = data.sort((a: any, b: any) => {
    return a.content.length - b.content.length;
  })
  
  const categories: {[s: string]: boolean} = {};
  for (const d of data) {
    if (!categories[d.metadata.subcategory]) {
      categories[d.metadata.subcategory] = true;
      // console.log(d.metadata.subcategory);
    }
  }
  console.log(data.length);

  Deno.writeTextFile(
    `./data/museum_trimmed.json`,
    JSON.stringify(data),
    {
      create: true,
    }
  );
}

if (import.meta.main) {
  main();
}
