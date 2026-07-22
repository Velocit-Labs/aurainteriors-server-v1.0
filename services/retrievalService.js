const { QdrantClient } = require("@qdrant/js-client-rest");

class RetrievalService {
  constructor() {
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    this.qdrantUrl = qdrantUrl;
    this.qdrantApiKey = qdrantApiKey;

    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });

    this.collectionName = "knowledge_base";
  }

  /**
   * Verify Qdrant connectivity at startup
   * Checks if URL is reachable and health check passes
   * Returns status info without throwing errors
   */
  async verifyQdrantConnection() {
    try {
      console.log("[startup] Qdrant Configuration:");
      console.log(`[startup] ✓ QDRANT_URL: ${this.qdrantUrl}`);
      console.log(`[startup] ${this.qdrantApiKey ? "✓" : "✗"} QDRANT_API_KEY: ${this.qdrantApiKey ? "SET" : "NOT SET"}`);

      // Attempt a basic health check / connection test
      console.log(`[startup] Testing Qdrant connection...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${this.qdrantUrl}/health`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.qdrantApiKey ? { "Authorization": `Bearer ${this.qdrantApiKey}` } : {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const healthData = await response.json();
        console.log(`[startup] ✓ Qdrant health check passed (status: ${healthData.status || "ok"})`);
        return { connected: true, status: "healthy" };
      } else {
        console.warn(`[startup] ⚠ Qdrant health check failed with status ${response.status}`);
        console.warn(`[startup] NETWORK/CONFIG CHECK: Verify that:`);
        console.warn(`[startup]   1. QDRANT_URL is correct: ${this.qdrantUrl}`);
        console.warn(`[startup]   2. Qdrant instance is running at that URL`);
        console.warn(`[startup]   3. QDRANT_API_KEY is correct (if required)`);
        console.warn(`[startup]   4. Render environment can reach the Qdrant instance (not localhost if Qdrant is remote)`);
        return { connected: false, status: `HTTP ${response.status}` };
      }
    } catch (error) {
      console.error(`[startup] ✗ Qdrant connection failed: ${error.message}`);
      console.error(`[startup] NETWORK/CONFIG CHECK: Verify that:`);
      console.error(`[startup]   1. QDRANT_URL is correct and reachable: ${this.qdrantUrl}`);
      console.error(`[startup]   2. Qdrant instance is running and accepting connections`);
      console.error(`[startup]   3. QDRANT_API_KEY is set correctly (if required)`);
      console.error(`[startup]   4. Firewall/network policies allow traffic from Render to Qdrant`);
      console.error(`[startup]   5. For localhost/private URLs, Qdrant must be in the same network or have a public endpoint`);
      console.error(`[startup] RAG features will be disabled until Qdrant is reachable.`);
      return { connected: false, status: `Connection error: ${error.message}` };
    }
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
   * Logs detailed error info to help diagnose connectivity/config issues
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
      // Provide diagnostic info to help identify if this is a connectivity vs configuration issue
      if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT")) {
        console.error(`[RAG] ✗ Qdrant connection failed: ${error.message}`);
        console.error(`[RAG] DIAGNOSTIC: This is likely a network connectivity issue:`);
        console.error(`[RAG]   - Qdrant URL: ${this.qdrantUrl}`);
        console.error(`[RAG]   - Check if Qdrant instance is running and reachable from production environment`);
        console.error(`[RAG]   - If using localhost, Qdrant must be accessible from Render's network`);
      } else if (error.message.includes("401") || error.message.includes("403")) {
        console.error(`[RAG] ✗ Qdrant authentication failed: ${error.message}`);
        console.error(`[RAG] DIAGNOSTIC: Check QDRANT_API_KEY configuration`);
      } else if (error.message.includes("404")) {
        console.error(`[RAG] ✗ Qdrant collection not found: ${error.message}`);
        console.error(`[RAG] DIAGNOSTIC: Collection "${this.collectionName}" does not exist or URL is incorrect`);
      } else {
        console.error(`[RAG] ✗ Qdrant similarity search failed: ${error.message}`);
      }
      
      // Fallback: return empty array so system does not crash
      return [];
    }
  }
}

module.exports = new RetrievalService();
