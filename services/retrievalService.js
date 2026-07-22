const { QdrantClient } = require("@qdrant/js-client-rest");

class RetrievalService {
  constructor() {
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });

    this.collectionName = "knowledge_base";
  }

  /**
   * Helper to retrieve embedding vector for a given query string
   */
  async getEmbedding(text, inputType = "query") {
    const apiKey = process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing API Key for embedding model in environment variables.");
    }

    const url = process.env.EMBEDDING_API_URL || "https://integrate.api.nvidia.com/v1/embeddings";
    const model = process.env.EMBEDDING_MODEL_NAME || "nvidia/llama-3.2-nv-embed-qa-4";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: [text],
          model: model,
          encoding_format: "float",
          ...(model.startsWith("nvidia/") ? { input_type: inputType } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding model responded with status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      if (!result.data || result.data.length === 0) {
        throw new Error("Empty data returned from embedding service");
      }

      return result.data[0].embedding;
    } catch (error) {
      console.error("Embedding generation failed:", error.message);
      throw error;
    }
  }

  /**
   * Perform vector similarity search against Qdrant index
   */
  async search(query, limit = 5, minScore = 0.5) {
    try {
      console.log(`[RAG] Generating embedding for query: "${query}"`);
      const queryEmbedding = await this.getEmbedding(query, "query");

      console.log(`[RAG] Searching Qdrant collection: "${this.collectionName}"`);
      const searchResult = await this.qdrant.search(this.collectionName, {
        vector: queryEmbedding,
        limit: limit,
        with_payload: true,
      });

      // Filter and map results that meet the minimum confidence score
      const matches = searchResult
        .filter((hit) => hit.score >= minScore)
        .map((hit) => ({
          text: hit.payload.text,
          fileName: hit.payload.fileName,
          documentId: hit.payload.documentId,
          score: hit.score,
        }));

      console.log(`[RAG] Found ${matches.length} matching chunks matching score >= ${minScore}`);
      return matches;
    } catch (error) {
      console.error("Qdrant similarity search failed:", error.message);
      // Fallback: return empty array so system does not crash
      return [];
    }
  }
}

module.exports = new RetrievalService();
