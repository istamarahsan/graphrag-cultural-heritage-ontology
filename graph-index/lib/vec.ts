/**
 * Calculates the cosine similarity between two vectors.
 *
 * @param vecA The first vector (as a number array).
 * @param vecB The second vector (as a number array).
 * @returns The cosine similarity score (between -1 and 1), or NaN if vectors are zero vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same dimensions.");
  }

  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));

  if (magnitudeA === 0 || magnitudeB === 0) {
    return NaN; // Handle zero vectors
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Performs a similarity search by comparing a search vector against a list of vectors.
 * Returns the top N vectors with their original index.
 *
 * @param searchVector The vector to search for similar vectors to.
 * @param vectorList An array of vectors to compare against (number arrays).
 * @param topN The number of most similar vectors to return.
 * @returns An array of objects, each containing the original index and the vector,
 * sorted by cosine similarity in descending order (top N).
 */
export function similaritySearch(
  searchVector: number[],
  vectorList: number[][],
  topN: number,
): { originalIndex: number; vector: number[] }[] {
  if (
    !Array.isArray(searchVector) || !Array.isArray(vectorList) ||
    typeof topN !== "number" || topN < 1
  ) {
    throw new Error("Invalid input parameters for findSimilarVectors.");
  }

  if (
    !vectorList.every((vec) =>
      Array.isArray(vec) && vec.length === searchVector.length
    )
  ) {
    throw new Error(
      "All vectors in vectorList must be number arrays with the same length as searchVector.",
    );
  }

  const similarities = vectorList.map((vector, index) => {
    const dotProduct = searchVector.reduce(
      (sum, a, i) => sum + a * vector[i],
      0,
    );
    const magnitudeA = Math.sqrt(
      searchVector.reduce((sum, a) => sum + a * a, 0),
    );
    const magnitudeB = Math.sqrt(vector.reduce((sum, b) => sum + b * b, 0));

    let score = NaN;
    if (magnitudeA !== 0 && magnitudeB !== 0) {
      score = dotProduct / (magnitudeA * magnitudeB);
    }

    return { originalIndex: index, vector, score };
  });

  // Sort by similarity score in descending order
  similarities.sort((a, b) => b.score - a.score);

  // Take the top N results, filtering out NaN scores (if any occurred due to zero vectors)
  return similarities
    .filter((item) => !isNaN(item.score))
    .slice(0, topN)
    .map(({ originalIndex, vector }) => ({ originalIndex, vector }));
}
