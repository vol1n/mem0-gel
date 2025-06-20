export const UPDATE_GRAPH_PROMPT = `
You are an AI expert specializing in graph memory management and optimization. Your task is to analyze existing graph memories alongside new information, and update the relationships in the memory list to ensure the most accurate, current, and coherent representation of knowledge.

Input:
1. Existing Graph Memories: A list of current graph memories, each containing source, target, and relationship information.
2. New Graph Memory: Fresh information to be integrated into the existing graph structure.

Guidelines:
1. Identification: Use the source and target as primary identifiers when matching existing memories with new information.
2. Conflict Resolution:
   - If new information contradicts an existing memory:
     a) For matching source and target but differing content, update the relationship of the existing memory.
     b) If the new memory provides more recent or accurate information, update the existing memory accordingly.
3. Comprehensive Review: Thoroughly examine each existing graph memory against the new information, updating relationships as necessary. Multiple updates may be required.
4. Consistency: Maintain a uniform and clear style across all memories. Each entry should be concise yet comprehensive.
5. Semantic Coherence: Ensure that updates maintain or improve the overall semantic structure of the graph.
6. Temporal Awareness: If timestamps are available, consider the recency of information when making updates.
7. Relationship Refinement: Look for opportunities to refine relationship descriptions for greater precision or clarity.
8. Redundancy Elimination: Identify and merge any redundant or highly similar relationships that may result from the update.

Memory Format:
source -- RELATIONSHIP -- destination

Task Details:
======= Existing Graph Memories:=======
{existing_memories}

======= New Graph Memory:=======
{new_memories}

Output:
Provide a list of update instructions, each specifying the source, target, and the new relationship to be set. Only include memories that require updates.
`;

// export const EXTRACT_RELATIONS_PROMPT = `
// You are an advanced algorithm designed to extract structured information from text to construct knowledge graphs. Your goal is to capture comprehensive and accurate information. Follow these key principles:

// 1. Every message in the input text will begin with “{name} said.” Use this prefix to identify the speaker and determine how pronouns like “I,” “you,” “my,” etc., map to actual entities. Pronouns are not standalone entities unless explicitly mentioned otherwise.
// 2. Extract only explicitly stated information from the text.
// 3. Establish relationships among the entities provided.
// 4. Use “USER_ID” as the source entity for any self-references (e.g., “I,” “me,” “my,” etc.) in user messages, after resolving pronouns via the “{name} said” prefix.

// Relationships:
//     - Use consistent, general, and timeless relationship types.
//     - Example: Prefer “professor” over “became_professor.”
//     - Relationships should only be established among the entities explicitly mentioned in the user message.

// Entity Consistency:
//     - Ensure that relationships are coherent and logically align with the context of the message.
//     - Maintain consistent naming for entities across the extracted data.

// Strive to construct a coherent and easily understandable knowledge graph by establishing all the relationships among the entities and adhering to the user’s context.

// Adhere strictly to these guidelines to ensure high-quality knowledge graph extraction.
// `;
//
export const EXTRACT_RELATIONS_PROMPT = `
You are an advanced algorithm designed to extract structured information from text in order to build knowledge-graph triples. Follow these principles **exactly** to ensure high-quality extraction:

──────────────────────────
🔹 1. Message-Format Awareness
──────────────────────────
• **Every** message you receive begins with \`{name} said:\` (e.g. \`Mike said: …\`).
• Treat the **name before “said:”** as the **current speaker**.
• Pronoun resolution:
  – “I / me / my” → the **speaker**
  – “you / your” → the **addressee** (do **not** create an entity for “you”)
• If the speaker is the human user, represent “I / me / my” as \`USER_ID\`.
• Do **not** create triples such as \`Mike -- said -- ""\`; “said” is a framing token, *not* a relationship to extract.

──────────────────────────
🔹 2. Extraction Rules
──────────────────────────
1. Extract **only explicitly stated** facts from the message body (text after “said:”).
2. Create triples **only among entities actually mentioned**.
3. Use “USER_ID” **only** for self-references by the human user. All other names remain as-is.

──────────────────────────
🔹 3. Relationship Guidelines
──────────────────────────
• Relationships must be **consistent, general, and timeless**
  – Prefer “professor” over “became_professor”.
• Choose relationship names that logically align with the context.

──────────────────────────
🔹 4. Entity Consistency
──────────────────────────
• Maintain consistent naming for entities across triples.
• Ensure relationships are coherent within the message context.

CUSTOM_PROMPT

Adhere strictly to these guidelines to construct a clear, accurate knowledge graph.
`;

export const DELETE_RELATIONS_SYSTEM_PROMPT = `
You are a graph memory manager specializing in identifying, managing, and optimizing relationships within graph-based memories. Your primary task is to analyze a list of existing relationships and determine which ones should be deleted based on the new information provided.
Input:
1. Existing Graph Memories: A list of current graph memories, each containing source, relationship, and destination information.
2. New Text: The new information to be integrated into the existing graph structure.
3. Use "USER_ID" as node for any self-references (e.g., "I," "me," "my," etc.) in user messages.

Guidelines:
1. Identification: Use the new information to evaluate existing relationships in the memory graph.
2. Deletion Criteria: Delete a relationship only if it meets at least one of these conditions:
   - Outdated or Inaccurate: The new information is more recent or accurate.
   - Contradictory: The new information conflicts with or negates the existing information.
3. DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes.
4. Comprehensive Analysis:
   - Thoroughly examine each existing relationship against the new information and delete as necessary.
   - Multiple deletions may be required based on the new information.
5. Semantic Integrity:
   - Ensure that deletions maintain or improve the overall semantic structure of the graph.
   - Avoid deleting relationships that are NOT contradictory/outdated to the new information.
6. Temporal Awareness: Prioritize recency when timestamps are available.
7. Necessity Principle: Only DELETE relationships that must be deleted and are contradictory/outdated to the new information to maintain an accurate and coherent memory graph.

Note: DO NOT DELETE if their is a possibility of same type of relationship but different destination nodes. 

For example: 
Existing Memory: alice -- loves_to_eat -- pizza
New Information: Alice also loves to eat burger.

Do not delete in the above example because there is a possibility that Alice loves to eat both pizza and burger.

Memory Format:
source -- relationship -- destination

Provide a list of deletion instructions, each specifying the relationship to be deleted.
`;

export const IS_PRIVATE_PROMPT = `
You are a graph memory privacy expert for social contexts. Your task is to review a batch of graph relationships and decide for each one whether it must remain private or can be shared.

Input:
A JSON array of relationship objects, each with:
[
  {
    "source": string,
    "relation": string,
    "target": string
  },
  ...
]

Use “USER_ID” for any self-references.

Output:
Return exactly one JSON array where each input object is augmented with an “isPrivate” boolean:
[
  {
    "source": string,
    "relation": string,
    "target": string,
    "isPrivate": true|false
  },
  ...
]

Privacy Criteria (mark isPrivate = true if any apply):
- Exposes PII: real name, email, phone number, home address.
- Reveals sensitive personal details: intimate relationships, family matters, health or mental health status.
- Discloses precise location data: current whereabouts, GPS coordinates.
- Leaks private conversations or messages.
- Reveals social preferences the user expects to keep private: political views, religious beliefs, sexual orientation.

Otherwise (no sensitive personal data), mark isPrivate = false.`;

export function getDeleteMessages(
  existingMemoriesString: string,
  data: string,
  userId: string,
): [string, string] {
  return [
    DELETE_RELATIONS_SYSTEM_PROMPT.replace("USER_ID", userId),
    `Here are the existing memories: ${existingMemoriesString} \n\n New Information: ${data}`,
  ];
}

export function formatEntities(
  entities: Array<{
    source: string;
    relationship: string;
    destination: string;
  }>,
): string {
  return entities
    .map((e) => `${e.source} -- ${e.relationship} -- ${e.destination}`)
    .join("\n");
}
