import _ from "lodash";

export type TextChunk = {
  id: string;
  content: string;
};

export type ChunkingOptions = {
  maxCharLength: number;
  minSentences: number;
  maxSentences: number;
  sentenceOverlap: number;
};
export function chunkBySentence(
  text: string,
  {
    maxCharLength,
    minSentences,
    maxSentences,
    sentenceOverlap,
  }: ChunkingOptions,
): string[][] {
  const sentences = text.split(".").map((t) => t.trim());
  return sentences.reduce(
    (chunks, sentence) => {
      const latest_chunk = chunks.at(-1)!;
      if (latest_chunk.length < minSentences) {
        latest_chunk.push(sentence);
        return chunks;
      }

      const n_chunk_length = latest_chunk.reduce(
        (length, text) => length + text.length,
        0,
      );

      const over_characters = n_chunk_length + sentence.length >= maxCharLength;
      const over_sentences = latest_chunk.length >= maxSentences;
      const create_new_chunk = over_characters || over_sentences;
      if (create_new_chunk) {
        return [...chunks, [...latest_chunk.slice(-sentenceOverlap), sentence]];
      }

      latest_chunk.push(sentence);
      return chunks;
    },
    [[]] as string[][],
  );
}
