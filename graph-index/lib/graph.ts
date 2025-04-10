import N3 from "n3";

/**
 * Retrieves a subgraph containing nodes within N hops of the starting nodes
 * and all triples connected to those nodes.
 *
 * @param store The full N3.Store containing the graph data.
 * @param startNodeUris An array of full URI strings for the starting nodes.
 * @param hops The maximum number of relationship hops (0 means only triples directly involving start nodes).
 * @returns A new N3.Store containing the subgraph.
 */
export function getNHopSubgraph(
  store: N3.Store,
  startNodeUris: string[],
  hops: number
): N3.Store {
  const { namedNode, literal } = N3.DataFactory;
  const subgraphStore = new N3.Store();

  // --- Step 1: Identify all nodes within N hops using BFS ---
  const allNodesInSubgraph = new Set<string>(startNodeUris); // Use node URIs/IDs as keys
  let frontier = new Set<string>(startNodeUris); // Nodes to explore in the current hop

  for (let i = 0; i < hops; i++) {
    const nextFrontier = new Set<string>();
    if (frontier.size === 0) {
      console.debug(`BFS stopped early at hop ${i} as frontier became empty.`);
      break; // No new nodes found in the previous hop
    }

    for (const nodeId of frontier) {
      let nodeTerm: N3.NamedNode | N3.BlankNode | N3.Literal;
      try {
        if (nodeId.startsWith("https://tix.fyi/museum#")) {
          nodeTerm = namedNode(nodeId);
        } else {
          nodeTerm = literal(nodeId);
        }
      } catch (e) {
        console.warn(`Could not create term for node ID: ${nodeId}`, e);
        continue;
      }

      // Find neighbors via outgoing links (node -> object)
      for (const quad of store.getQuads(nodeTerm, null, null, null)) {
        if (
          quad.object.termType === "NamedNode" ||
          quad.object.termType === "BlankNode"
        ) {
          const neighborId = quad.object.id; // .id works for both NamedNode (value) and BlankNode (id)
          if (!allNodesInSubgraph.has(neighborId)) {
            allNodesInSubgraph.add(neighborId);
            nextFrontier.add(neighborId);
          }
        }
      }

      // Find neighbors via incoming links (subject -> node)
      for (const quad of store.getQuads(null, null, nodeTerm, null)) {
        if (
          quad.subject.termType === "NamedNode" ||
          quad.subject.termType === "BlankNode"
        ) {
          const neighborId = quad.subject.id;
          if (!allNodesInSubgraph.has(neighborId)) {
            allNodesInSubgraph.add(neighborId);
            nextFrontier.add(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier; // Move to the next level
  }

  // Clear the store first before adding based on the stricter logic
  subgraphStore.removeQuads(subgraphStore.getQuads(null, null, null, null));
  let addedQuadsCount = 0;

  for (const quad of store.getQuads(null, null, null, null)) {
    const subjectId = quad.subject.id;
    if (allNodesInSubgraph.has(subjectId)) {
      // If the subject is in our set, include the quad if the object is a Literal OR also in our set
      if (
        quad.object.termType === "Literal" ||
        allNodesInSubgraph.has(quad.object.id)
      ) {
        subgraphStore.addQuad(quad);
        addedQuadsCount++;
      }
    }
  }

  return subgraphStore;
}
