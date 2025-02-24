import fs from 'fs';
import * as pdfreader from 'pdf-text-reader';

async function convertChaptersToArray(pdfPath: string) {
    let pdf_text: string = await pdfreader.readPdfText({ url: pdfPath });
    pdf_text = pdf_text.replace(/\d+\sMINANGKABAU \(Adat, Bahasa, Sastra dan Bentuk Penerapan\)/g, '');

    let text = `
    BAGIAN I
    MINANGKABAU DAN BAHASA
    A. Seputar Tentang Minangkabau
    Menurut Ibrahim Dt. Sanggoeno Dirajo (2009), ...
    B. Kebudayaan
    Adat dan budaya Minangkabau mempunyai ...
    BAGIAN II
    KESUSASTRAAN MINANGKABAU
    Sebuah perubahan akan dirasakan jika sesuatu itu telah ...
    A. Petatah Petitih
    Petatah petitih atau pepatah petitih ...
    `;
    text = pdf_text;

    const chapterPattern = /BAGIAN (I|II|III)\s(.+?)(?=BAGIAN (I|II|III)|$)/gs;
    const subChapterPattern = /([A-K])\. (.+?)(?=(?:[A-K]\. )|$)/gs;

    let match;
    const chapters = [];

    let chapterCount = 0;
    let end = false;

    while ((match = chapterPattern.exec(text)) !== null) {
        if (chapterCount < 3) { // Skip the first three chapters
            chapterCount++;
            continue;
        }

        let [fullMatch, chapterNum, chapterText] = match;

        const titleMatch = chapterText.match(/(.+?)(?:\n|$)/);
        let chapterTitle = titleMatch ? titleMatch[1] : "Unknown Title";

        const subChapters = [];
        let subMatch;
        while ((subMatch = subChapterPattern.exec(chapterText)) !== null) {
            let [subFullMatch, subChar, subText] = subMatch;
            let subTitle = subText.split('\n')[0].trim();
            let text = subText.replace(/^(.+?)\n/, '').replace(/\s+/g, ' ').trim();

            if (text.includes("Daftar Pustaka Amir")) {
                text = text.split("Daftar Pustaka Amir")[0].trim();
                end = true;
            }

            subChapters.push({
                subChar,
                subTitle,
                subText: text,
            });

            if (end)
                break;
        }

        // If no subchapters found, treat the remaining text as the subchapter
        if (subChapters.length === 0) {
            subChapters.push({
                subChar: null,
                subTitle: null,
                subText: chapterText.replace(/\s+/g, ' '),
            });
        }

        chapters.push({ chapterNum, chapterTitle: chapterTitle.trim(), subChapters });

        if (end)
            break;
    }

    // console.log(JSON.stringify(chapters, null, 2));
    return chapters;
}

async function writeToJSON(name: string, data: any) {
    const glossaryJson = JSON.stringify(data, null, 2);
    fs.writeFileSync(`./${name}.json`, glossaryJson, 'utf-8');
}

async function main() {
    const pdfPath = './file.pdf';
    const jsonPath = 'output.json';

    try {
        const chapters = await convertChaptersToArray(pdfPath);
        writeToJSON('chapters', chapters);
    } catch (err) {
        console.error('Error reading PDF:', err);
    }
}

main();