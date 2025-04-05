import axios from 'axios';
import { load as LoadWeb } from 'cheerio';

async function main() {
  const fileContent = await Deno.readTextFile('./data/museum_nasional_scraped.json');
  const jsonData: {
    url: string,
    title: string,
    content: string,
    type: "collection" | "news" | "publication",
    date: string,
  }[] = JSON.parse(fileContent);

  const new_scraped_data = [];
  for (const scraped_data of jsonData) {
    try {
      const { data } = await axios.get(scraped_data.url);
      const $ = LoadWeb(data);
  
      const breadcrumbs = $('.entry-crumbs span[itemtype="http://data-vocabulary.org/Breadcrumb"]');
      const secondToLastBreadcrumb = breadcrumbs.eq(-2).text().trim();
  
      console.log('Second to last breadcrumb:', secondToLastBreadcrumb);
      new_scraped_data.push({
        ...scraped_data,
        subcategory: secondToLastBreadcrumb,
      });
    } catch (_error) {
      new_scraped_data.push({
        ...scraped_data,
        subcategory: null,
      });
      // console.error('Error scraping the website:', error);
    }
  }

  Deno.writeTextFile(
    `./data/new_scraped_data.json`,
    JSON.stringify(new_scraped_data),
    {
      create: true,
    }
  );
}

if (import.meta.main) {
  main();
}
