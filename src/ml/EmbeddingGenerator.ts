import * as fs from "fs/promises";
import * as path from "path";
import type { CombinedFeatures } from "./FeatureExtractor.js";
import type { EmbeddingVector, SymbolEmbedding } from "./RelevanceScorer.js";

export interface Word2VecModel {
  vocabulary: Map<string, number>;
  embeddings: Float32Array[];
  dimensions: number;
  windowSize: number;
  minCount: number;
  iterations: number;
}

export interface Doc2VecModel {
  wordModel: Word2VecModel;
  documentEmbeddings: Map<string, Float32Array>;
  alpha: number;
  minAlpha: number;
}

export interface CodeEmbeddingModel {
  tokenEmbeddings: Map<string, Float32Array>;
  structuralEmbeddings: Map<string, Float32Array>;
  semanticEmbeddings: Map<string, Float32Array>;
  dimensions: number;
  combinationWeights: {
    token: number;
    structural: number;
    semantic: number;
  };
}

export interface SimilarityMetrics {
  cosine: number;
  euclidean: number;
  manhattan: number;
  jaccard: number;
  pearson: number;
}

export interface ClusterInfo {
  id: string;
  centroid: Float32Array;
  members: string[];
  cohesion: number;
  separation: number;
  silhouetteScore: number;
}

export interface DimensionalityReduction {
  method: "pca" | "tsne" | "umap";
  originalDimensions: number;
  reducedDimensions: number;
  explainedVariance?: number;
  components?: Float32Array[];
}

export class EmbeddingGenerator {
  private word2vecModel: Word2VecModel | null = null;
  private doc2vecModel: Doc2VecModel | null = null;
  private codeModel: CodeEmbeddingModel | null = null;
  private embeddingCache: Map<string, Float32Array> = new Map();
  private similarityCache: Map<string, SimilarityMetrics> = new Map();

  constructor(
    private dimensions: number = 256,
    private windowSize: number = 5,
    private minCount: number = 2,
  ) {}

  /**
   * Train Word2Vec model on code tokens
   */
  async trainWord2Vec(corpus: string[][]): Promise<Word2VecModel> {
    console.log("Training Word2Vec model...");

    // Build vocabulary
    const vocabulary = this.buildVocabulary(corpus);
    console.log(`Vocabulary size: ${vocabulary.size}`);

    // Initialize embeddings randomly
    const embeddings = this.initializeEmbeddings(vocabulary.size);

    // Train using Skip-gram with negative sampling
    await this.trainSkipGram(corpus, vocabulary, embeddings);

    this.word2vecModel = {
      vocabulary,
      embeddings,
      dimensions: this.dimensions,
      windowSize: this.windowSize,
      minCount: this.minCount,
      iterations: 10,
    };

    console.log("Word2Vec training completed");
    return this.word2vecModel;
  }

  /**
   * Train Doc2Vec model for document-level embeddings
   */
  async trainDoc2Vec(
    documents: Array<{ id: string; tokens: string[] }>,
  ): Promise<Doc2VecModel> {
    console.log("Training Doc2Vec model...");

    // First train Word2Vec on all tokens
    const allTokens = documents.map((doc) => doc.tokens);
    const wordModel = await this.trainWord2Vec(allTokens);

    // Train document embeddings
    const documentEmbeddings = new Map<string, Float32Array>();

    for (const doc of documents) {
      const embedding = await this.trainDocumentEmbedding(doc, wordModel);
      documentEmbeddings.set(doc.id, embedding);
    }

    this.doc2vecModel = {
      wordModel,
      documentEmbeddings,
      alpha: 0.025,
      minAlpha: 0.0001,
    };

    console.log("Doc2Vec training completed");
    return this.doc2vecModel;
  }

  /**
   * Train specialized code embedding model
   */
  async trainCodeEmbeddings(
    codeData: Array<{
      symbol: string;
      tokens: string[];
      structure: string[];
      semantics: string[];
      features: CombinedFeatures;
    }>,
  ): Promise<CodeEmbeddingModel> {
    console.log("Training code embedding model...");

    // Train token embeddings
    const tokenCorpus = codeData.map((item) => item.tokens);
    const tokenModel = await this.trainWord2Vec(tokenCorpus);
    const tokenEmbeddings = new Map<string, Float32Array>();

    for (const [token, index] of tokenModel.vocabulary) {
      tokenEmbeddings.set(token, tokenModel.embeddings[index]);
    }

    // Train structural embeddings
    const structuralCorpus = codeData.map((item) => item.structure);
    const structuralModel = await this.trainWord2Vec(structuralCorpus);
    const structuralEmbeddings = new Map<string, Float32Array>();

    for (const [token, index] of structuralModel.vocabulary) {
      structuralEmbeddings.set(token, structuralModel.embeddings[index]);
    }

    // Train semantic embeddings
    const semanticCorpus = codeData.map((item) => item.semantics);
    const semanticModel = await this.trainWord2Vec(semanticCorpus);
    const semanticEmbeddings = new Map<string, Float32Array>();

    for (const [token, index] of semanticModel.vocabulary) {
      semanticEmbeddings.set(token, semanticModel.embeddings[index]);
    }

    this.codeModel = {
      tokenEmbeddings,
      structuralEmbeddings,
      semanticEmbeddings,
      dimensions: this.dimensions,
      combinationWeights: {
        token: 0.5,
        structural: 0.3,
        semantic: 0.2,
      },
    };

    console.log("Code embedding training completed");
    return this.codeModel;
  }

  /**
   * Generate embedding for a symbol using trained models
   */
  async generateSymbolEmbedding(
    symbol: string,
    tokens: string[],
    structure: string[],
    semantics: string[],
    features: CombinedFeatures,
  ): Promise<EmbeddingVector> {
    const cacheKey = `${symbol}:${tokens.join(",")}`;
    const cached = this.embeddingCache.get(cacheKey);

    if (cached) {
      return {
        values: Array.from(cached),
        dimensions: cached.length,
        magnitude: this.calculateMagnitude(cached),
      };
    }

    let embedding: Float32Array;

    if (this.codeModel) {
      embedding = this.generateCodeEmbedding(
        tokens,
        structure,
        semantics,
        features,
      );
    } else if (this.doc2vecModel) {
      embedding = await this.generateDocEmbedding(tokens);
    } else if (this.word2vecModel) {
      embedding = this.generateWordEmbedding(tokens);
    } else {
      embedding = this.generateTfIdfEmbedding(tokens);
    }

    // Normalize the embedding
    this.normalizeEmbedding(embedding);

    // Cache the result
    this.embeddingCache.set(cacheKey, embedding);

    return {
      values: Array.from(embedding),
      dimensions: embedding.length,
      magnitude: this.calculateMagnitude(embedding),
    };
  }

  /**
   * Generate query embedding for search
   */
  async generateQueryEmbedding(query: string): Promise<EmbeddingVector> {
    const tokens = this.tokenizeQuery(query);
    const embedding = await this.generateSymbolEmbedding(
      "query",
      tokens,
      [],
      [],
      {} as CombinedFeatures,
    );

    return embedding;
  }

  /**
   * Calculate similarity between two embeddings
   */
  calculateSimilarity(
    embedding1: EmbeddingVector,
    embedding2: EmbeddingVector,
  ): SimilarityMetrics {
    const key = `${embedding1.values.join(",")}:${embedding2.values.join(",")}`;
    const cached = this.similarityCache.get(key);

    if (cached) return cached;

    const vec1 = new Float32Array(embedding1.values);
    const vec2 = new Float32Array(embedding2.values);

    const metrics: SimilarityMetrics = {
      cosine: this.cosineSimilarity(vec1, vec2),
      euclidean: this.euclideanDistance(vec1, vec2),
      manhattan: this.manhattanDistance(vec1, vec2),
      jaccard: this.jaccardSimilarity(embedding1.values, embedding2.values),
      pearson: this.pearsonCorrelation(vec1, vec2),
    };

    this.similarityCache.set(key, metrics);
    return metrics;
  }

  /**
   * Find most similar embeddings using approximate nearest neighbor search
   */
  async findSimilarEmbeddings(
    queryEmbedding: EmbeddingVector,
    candidateEmbeddings: Map<string, EmbeddingVector>,
    topK: number = 10,
    threshold: number = 0.1,
  ): Promise<
    Array<{ id: string; similarity: number; metrics: SimilarityMetrics }>
  > {
    const results: Array<{
      id: string;
      similarity: number;
      metrics: SimilarityMetrics;
    }> = [];

    for (const [id, embedding] of candidateEmbeddings) {
      const metrics = this.calculateSimilarity(queryEmbedding, embedding);

      if (metrics.cosine >= threshold) {
        results.push({
          id,
          similarity: metrics.cosine,
          metrics,
        });
      }
    }

    // Sort by similarity and return top K
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * Cluster embeddings using K-means
   */
  async clusterEmbeddings(
    embeddings: Map<string, EmbeddingVector>,
    numClusters: number,
    maxIterations: number = 100,
  ): Promise<ClusterInfo[]> {
    console.log(
      `Clustering ${embeddings.size} embeddings into ${numClusters} clusters...`,
    );

    const points = Array.from(embeddings.values()).map(
      (e) => new Float32Array(e.values),
    );
    const labels = Array.from(embeddings.keys());

    // Initialize centroids randomly
    const centroids = this.initializeCentroids(points, numClusters);
    const assignments = new Array(points.length).fill(0);

    // K-means iterations
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;

      // Assign points to nearest centroids
      for (let i = 0; i < points.length; i++) {
        const newAssignment = this.findNearestCentroid(points[i], centroids);
        if (newAssignment !== assignments[i]) {
          assignments[i] = newAssignment;
          changed = true;
        }
      }

      if (!changed) break;

      // Update centroids
      this.updateCentroids(points, assignments, centroids);
    }

    // Build cluster info
    const clusters: ClusterInfo[] = [];

    for (let k = 0; k < numClusters; k++) {
      const members = labels.filter((_, i) => assignments[i] === k);
      const cohesion = this.calculateCohesion(
        points,
        assignments,
        k,
        centroids[k],
      );
      const separation = this.calculateSeparation(centroids, k);
      const silhouetteScore = this.calculateSilhouetteScore(
        points,
        assignments,
        k,
      );

      clusters.push({
        id: `cluster_${k}`,
        centroid: centroids[k],
        members,
        cohesion,
        separation,
        silhouetteScore,
      });
    }

    console.log("Clustering completed");
    return clusters;
  }

  /**
   * Reduce dimensionality of embeddings
   */
  async reduceDimensionality(
    embeddings: Map<string, EmbeddingVector>,
    targetDimensions: number,
    method: "pca" | "tsne" | "umap" = "pca",
  ): Promise<{
    reducedEmbeddings: Map<string, EmbeddingVector>;
    reduction: DimensionalityReduction;
  }> {
    console.log(
      `Reducing dimensionality from ${this.dimensions} to ${targetDimensions} using ${method.toUpperCase()}...`,
    );

    const points = Array.from(embeddings.values()).map(
      (e) => new Float32Array(e.values),
    );
    const labels = Array.from(embeddings.keys());

    let reducedPoints: Float32Array[];
    let reduction: DimensionalityReduction;

    switch (method) {
      case "pca":
        const pcaResult = this.performPCA(points, targetDimensions);
        reducedPoints = pcaResult.reducedPoints;
        reduction = {
          method: "pca",
          originalDimensions: this.dimensions,
          reducedDimensions: targetDimensions,
          explainedVariance: pcaResult.explainedVariance,
          components: pcaResult.components,
        };
        break;

      case "tsne":
        reducedPoints = this.performTSNE(points, targetDimensions);
        reduction = {
          method: "tsne",
          originalDimensions: this.dimensions,
          reducedDimensions: targetDimensions,
        };
        break;

      case "umap":
        reducedPoints = this.performUMAP(points, targetDimensions);
        reduction = {
          method: "umap",
          originalDimensions: this.dimensions,
          reducedDimensions: targetDimensions,
        };
        break;

      default:
        throw new Error(
          `Unsupported dimensionality reduction method: ${method}`,
        );
    }

    // Convert back to embedding format
    const reducedEmbeddings = new Map<string, EmbeddingVector>();

    for (let i = 0; i < labels.length; i++) {
      const values = Array.from(reducedPoints[i]);
      reducedEmbeddings.set(labels[i], {
        values,
        dimensions: targetDimensions,
        magnitude: this.calculateMagnitude(reducedPoints[i]),
      });
    }

    console.log("Dimensionality reduction completed");
    return { reducedEmbeddings, reduction };
  }

  /**
   * Export trained models
   */
  async exportModels(outputPath: string): Promise<void> {
    const modelData = {
      word2vec: this.word2vecModel
        ? {
            vocabulary: Array.from(this.word2vecModel.vocabulary.entries()),
            embeddings: this.word2vecModel.embeddings.map((arr) =>
              Array.from(arr),
            ),
            dimensions: this.word2vecModel.dimensions,
            windowSize: this.word2vecModel.windowSize,
            minCount: this.word2vecModel.minCount,
            iterations: this.word2vecModel.iterations,
          }
        : null,

      doc2vec: this.doc2vecModel
        ? {
            wordModel: {
              vocabulary: Array.from(
                this.doc2vecModel.wordModel.vocabulary.entries(),
              ),
              embeddings: this.doc2vecModel.wordModel.embeddings.map((arr) =>
                Array.from(arr),
              ),
              dimensions: this.doc2vecModel.wordModel.dimensions,
            },
            documentEmbeddings: Array.from(
              this.doc2vecModel.documentEmbeddings.entries(),
            ).map(([id, emb]) => [id, Array.from(emb)]),
            alpha: this.doc2vecModel.alpha,
            minAlpha: this.doc2vecModel.minAlpha,
          }
        : null,

      codeModel: this.codeModel
        ? {
            tokenEmbeddings: Array.from(
              this.codeModel.tokenEmbeddings.entries(),
            ).map(([token, emb]) => [token, Array.from(emb)]),
            structuralEmbeddings: Array.from(
              this.codeModel.structuralEmbeddings.entries(),
            ).map(([token, emb]) => [token, Array.from(emb)]),
            semanticEmbeddings: Array.from(
              this.codeModel.semanticEmbeddings.entries(),
            ).map(([token, emb]) => [token, Array.from(emb)]),
            dimensions: this.codeModel.dimensions,
            combinationWeights: this.codeModel.combinationWeights,
          }
        : null,

      metadata: {
        dimensions: this.dimensions,
        windowSize: this.windowSize,
        minCount: this.minCount,
        createdAt: Date.now(),
      },
    };

    await fs.writeFile(outputPath, JSON.stringify(modelData, null, 2));
    console.log(`Models exported to ${outputPath}`);
  }

  /**
   * Import trained models
   */
  async importModels(inputPath: string): Promise<void> {
    const modelData = JSON.parse(await fs.readFile(inputPath, "utf-8"));

    if (modelData.word2vec) {
      this.word2vecModel = {
        vocabulary: new Map(modelData.word2vec.vocabulary),
        embeddings: modelData.word2vec.embeddings.map(
          (arr: number[]) => new Float32Array(arr),
        ),
        dimensions: modelData.word2vec.dimensions,
        windowSize: modelData.word2vec.windowSize,
        minCount: modelData.word2vec.minCount,
        iterations: modelData.word2vec.iterations,
      };
    }

    if (modelData.doc2vec) {
      this.doc2vecModel = {
        wordModel: {
          vocabulary: new Map(modelData.doc2vec.wordModel.vocabulary),
          embeddings: modelData.doc2vec.wordModel.embeddings.map(
            (arr: number[]) => new Float32Array(arr),
          ),
          dimensions: modelData.doc2vec.wordModel.dimensions,
          windowSize: 0,
          minCount: 0,
          iterations: 0,
        },
        documentEmbeddings: new Map(
          modelData.doc2vec.documentEmbeddings.map(
            ([id, emb]: [string, number[]]) => [id, new Float32Array(emb)],
          ),
        ),
        alpha: modelData.doc2vec.alpha,
        minAlpha: modelData.doc2vec.minAlpha,
      };
    }

    if (modelData.codeModel) {
      this.codeModel = {
        tokenEmbeddings: new Map(
          modelData.codeModel.tokenEmbeddings.map(
            ([token, emb]: [string, number[]]) => [
              token,
              new Float32Array(emb),
            ],
          ),
        ),
        structuralEmbeddings: new Map(
          modelData.codeModel.structuralEmbeddings.map(
            ([token, emb]: [string, number[]]) => [
              token,
              new Float32Array(emb),
            ],
          ),
        ),
        semanticEmbeddings: new Map(
          modelData.codeModel.semanticEmbeddings.map(
            ([token, emb]: [string, number[]]) => [
              token,
              new Float32Array(emb),
            ],
          ),
        ),
        dimensions: modelData.codeModel.dimensions,
        combinationWeights: modelData.codeModel.combinationWeights,
      };
    }

    console.log(`Models imported from ${inputPath}`);
  }

  // Private helper methods
  private buildVocabulary(corpus: string[][]): Map<string, number> {
    const tokenCounts = new Map<string, number>();

    // Count token frequencies
    for (const sentence of corpus) {
      for (const token of sentence) {
        tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
      }
    }

    // Filter by minimum count and build vocabulary
    const vocabulary = new Map<string, number>();
    let index = 0;

    for (const [token, count] of tokenCounts) {
      if (count >= this.minCount) {
        vocabulary.set(token, index++);
      }
    }

    return vocabulary;
  }

  private initializeEmbeddings(vocabularySize: number): Float32Array[] {
    const embeddings: Float32Array[] = [];

    for (let i = 0; i < vocabularySize; i++) {
      const embedding = new Float32Array(this.dimensions);

      // Xavier initialization
      const scale = Math.sqrt(2.0 / this.dimensions);
      for (let j = 0; j < this.dimensions; j++) {
        embedding[j] = (Math.random() - 0.5) * 2 * scale;
      }

      embeddings.push(embedding);
    }

    return embeddings;
  }

  private async trainSkipGram(
    corpus: string[][],
    vocabulary: Map<string, number>,
    embeddings: Float32Array[],
  ): Promise<void> {
    const learningRate = 0.025;
    const negativeSamples = 5;
    const iterations = 10;

    for (let iter = 0; iter < iterations; iter++) {
      console.log(`Training iteration ${iter + 1}/${iterations}`);

      for (const sentence of corpus) {
        for (let i = 0; i < sentence.length; i++) {
          const centerWord = sentence[i];
          const centerIndex = vocabulary.get(centerWord);

          if (centerIndex === undefined) continue;

          // Train on context words
          for (
            let j = Math.max(0, i - this.windowSize);
            j <= Math.min(sentence.length - 1, i + this.windowSize);
            j++
          ) {
            if (i === j) continue;

            const contextWord = sentence[j];
            const contextIndex = vocabulary.get(contextWord);

            if (contextIndex === undefined) continue;

            // Positive sample
            this.updateEmbeddings(
              embeddings,
              centerIndex,
              contextIndex,
              1,
              learningRate,
            );

            // Negative samples
            for (let k = 0; k < negativeSamples; k++) {
              const negativeIndex = Math.floor(
                Math.random() * embeddings.length,
              );
              if (negativeIndex !== contextIndex) {
                this.updateEmbeddings(
                  embeddings,
                  centerIndex,
                  negativeIndex,
                  0,
                  learningRate,
                );
              }
            }
          }
        }
      }
    }
  }

  private updateEmbeddings(
    embeddings: Float32Array[],
    centerIndex: number,
    contextIndex: number,
    label: number,
    learningRate: number,
  ): void {
    const centerEmb = embeddings[centerIndex];
    const contextEmb = embeddings[contextIndex];

    // Calculate dot product
    let dotProduct = 0;
    for (let i = 0; i < this.dimensions; i++) {
      dotProduct += centerEmb[i] * contextEmb[i];
    }

    // Sigmoid activation
    const sigmoid = 1 / (1 + Math.exp(-dotProduct));
    const gradient = (label - sigmoid) * learningRate;

    // Update embeddings
    for (let i = 0; i < this.dimensions; i++) {
      const centerGrad = gradient * contextEmb[i];
      const contextGrad = gradient * centerEmb[i];

      centerEmb[i] += centerGrad;
      contextEmb[i] += contextGrad;
    }
  }

  private async trainDocumentEmbedding(
    document: { id: string; tokens: string[] },
    wordModel: Word2VecModel,
  ): Promise<Float32Array> {
    const embedding = new Float32Array(this.dimensions);
    let count = 0;

    // Average word embeddings
    for (const token of document.tokens) {
      const index = wordModel.vocabulary.get(token);
      if (index !== undefined) {
        const wordEmb = wordModel.embeddings[index];
        for (let i = 0; i < this.dimensions; i++) {
          embedding[i] += wordEmb[i];
        }
        count++;
      }
    }

    // Normalize by count
    if (count > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= count;
      }
    }

    return embedding;
  }

  private generateCodeEmbedding(
    tokens: string[],
    structure: string[],
    semantics: string[],
    features: CombinedFeatures,
  ): Float32Array {
    if (!this.codeModel) {
      throw new Error("Code model not trained");
    }

    const embedding = new Float32Array(this.dimensions);
    const weights = this.codeModel.combinationWeights;

    // Combine token embeddings
    const tokenEmb = this.averageEmbeddings(
      tokens,
      this.codeModel.tokenEmbeddings,
    );
    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] += tokenEmb[i] * weights.token;
    }

    // Combine structural embeddings
    const structEmb = this.averageEmbeddings(
      structure,
      this.codeModel.structuralEmbeddings,
    );
    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] += structEmb[i] * weights.structural;
    }

    // Combine semantic embeddings
    const semEmb = this.averageEmbeddings(
      semantics,
      this.codeModel.semanticEmbeddings,
    );
    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] += semEmb[i] * weights.semantic;
    }

    // Add feature-based components
    this.addFeatureComponents(embedding, features);

    return embedding;
  }

  private async generateDocEmbedding(tokens: string[]): Promise<Float32Array> {
    if (!this.doc2vecModel) {
      throw new Error("Doc2Vec model not trained");
    }

    return this.averageEmbeddings(
      tokens,
      this.doc2vecModel.wordModel.embeddings,
      this.doc2vecModel.wordModel.vocabulary,
    );
  }

  private generateWordEmbedding(tokens: string[]): Float32Array {
    if (!this.word2vecModel) {
      throw new Error("Word2Vec model not trained");
    }

    return this.averageEmbeddings(
      tokens,
      this.word2vecModel.embeddings,
      this.word2vecModel.vocabulary,
    );
  }

  private generateTfIdfEmbedding(tokens: string[]): Float32Array {
    // Fallback TF-IDF based embedding
    const embedding = new Float32Array(this.dimensions);
    const tokenCounts = new Map<string, number>();

    // Count token frequencies
    for (const token of tokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }

    // Simple hash-based embedding
    for (const [token, count] of tokenCounts) {
      const hash = this.hashString(token);
      const tf = count / tokens.length;

      for (let i = 0; i < this.dimensions; i++) {
        const index = (hash + i) % this.dimensions;
        embedding[index] += tf;
      }
    }

    return embedding;
  }

  private averageEmbeddings(
    tokens: string[],
    embeddingSource: Map<string, Float32Array> | Float32Array[],
    vocabulary?: Map<string, number>,
  ): Float32Array {
    const embedding = new Float32Array(this.dimensions);
    let count = 0;

    for (const token of tokens) {
      let tokenEmb: Float32Array | undefined;

      if (embeddingSource instanceof Map) {
        tokenEmb = embeddingSource.get(token);
      } else if (vocabulary) {
        const index = vocabulary.get(token);
        if (index !== undefined) {
          tokenEmb = embeddingSource[index];
        }
      }

      if (tokenEmb) {
        for (let i = 0; i < this.dimensions; i++) {
          embedding[i] += tokenEmb[i];
        }
        count++;
      }
    }

    // Normalize by count
    if (count > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= count;
      }
    }

    return embedding;
  }

  private addFeatureComponents(
    embedding: Float32Array,
    features: CombinedFeatures,
  ): void {
    // Add feature-based components to the last dimensions
    const featureStart = this.dimensions - 20;

    if (featureStart > 0) {
      embedding[featureStart] += features.relevanceScore;
      embedding[featureStart + 1] += features.qualityScore;
      embedding[featureStart + 2] += features.maintainabilityScore;
      embedding[featureStart + 3] += 1 - features.riskScore;
      embedding[featureStart + 4] += features.semantic.purposeClarity;
      embedding[featureStart + 5] += features.semantic.businessRelevance;
      embedding[featureStart + 6] += features.code.maintainabilityIndex / 100;
      embedding[featureStart + 7] += features.usage.totalUsageCount / 100;
    }
  }

  private normalizeEmbedding(embedding: Float32Array): void {
    const magnitude = this.calculateMagnitude(embedding);

    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
  }

  private calculateMagnitude(embedding: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < embedding.length; i++) {
      sum += embedding[i] * embedding[i];
    }
    return Math.sqrt(sum);
  }

  private tokenizeQuery(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1);
  }

  // Similarity calculation methods
  private cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  private euclideanDistance(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) return Infinity;

    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  private manhattanDistance(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) return Infinity;

    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      sum += Math.abs(vec1[i] - vec2[i]);
    }

    return sum;
  }

  private jaccardSimilarity(vec1: number[], vec2: number[]): number {
    const set1 = new Set(
      vec1.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0),
    );
    const set2 = new Set(
      vec2.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0),
    );

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private pearsonCorrelation(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) return 0;

    const n = vec1.length;
    let sum1 = 0,
      sum2 = 0,
      sum1Sq = 0,
      sum2Sq = 0,
      pSum = 0;

    for (let i = 0; i < n; i++) {
      sum1 += vec1[i];
      sum2 += vec2[i];
      sum1Sq += vec1[i] * vec1[i];
      sum2Sq += vec2[i] * vec2[i];
      pSum += vec1[i] * vec2[i];
    }

    const num = pSum - (sum1 * sum2) / n;
    const den = Math.sqrt(
      (sum1Sq - (sum1 * sum1) / n) * (sum2Sq - (sum2 * sum2) / n),
    );

    return den > 0 ? num / den : 0;
  }

  // Clustering helper methods
  private initializeCentroids(
    points: Float32Array[],
    numClusters: number,
  ): Float32Array[] {
    const centroids: Float32Array[] = [];
    const dimensions = points[0].length;

    // K-means++ initialization
    const firstIndex = Math.floor(Math.random() * points.length);
    centroids.push(new Float32Array(points[firstIndex]));

    for (let k = 1; k < numClusters; k++) {
      const distances: number[] = [];
      let totalDistance = 0;

      for (const point of points) {
        let minDistance = Infinity;
        for (const centroid of centroids) {
          const distance = this.euclideanDistance(point, centroid);
          minDistance = Math.min(minDistance, distance);
        }
        distances.push(minDistance * minDistance);
        totalDistance += minDistance * minDistance;
      }

      const random = Math.random() * totalDistance;
      let cumulative = 0;

      for (let i = 0; i < points.length; i++) {
        cumulative += distances[i];
        if (cumulative >= random) {
          centroids.push(new Float32Array(points[i]));
          break;
        }
      }
    }

    return centroids;
  }

  private findNearestCentroid(
    point: Float32Array,
    centroids: Float32Array[],
  ): number {
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < centroids.length; i++) {
      const distance = this.euclideanDistance(point, centroids[i]);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  private updateCentroids(
    points: Float32Array[],
    assignments: number[],
    centroids: Float32Array[],
  ): void {
    const dimensions = points[0].length;

    for (let k = 0; k < centroids.length; k++) {
      const clusterPoints = points.filter((_, i) => assignments[i] === k);

      if (clusterPoints.length > 0) {
        centroids[k].fill(0);

        for (const point of clusterPoints) {
          for (let d = 0; d < dimensions; d++) {
            centroids[k][d] += point[d];
          }
        }

        for (let d = 0; d < dimensions; d++) {
          centroids[k][d] /= clusterPoints.length;
        }
      }
    }
  }

  private calculateCohesion(
    points: Float32Array[],
    assignments: number[],
    clusterIndex: number,
    centroid: Float32Array,
  ): number {
    const clusterPoints = points.filter(
      (_, i) => assignments[i] === clusterIndex,
    );

    if (clusterPoints.length === 0) return 0;

    let totalDistance = 0;
    for (const point of clusterPoints) {
      totalDistance += this.euclideanDistance(point, centroid);
    }

    return totalDistance / clusterPoints.length;
  }

  private calculateSeparation(
    centroids: Float32Array[],
    clusterIndex: number,
  ): number {
    let minDistance = Infinity;

    for (let i = 0; i < centroids.length; i++) {
      if (i !== clusterIndex) {
        const distance = this.euclideanDistance(
          centroids[clusterIndex],
          centroids[i],
        );
        minDistance = Math.min(minDistance, distance);
      }
    }

    return minDistance;
  }

  private calculateSilhouetteScore(
    points: Float32Array[],
    assignments: number[],
    clusterIndex: number,
  ): number {
    const clusterPoints = points.filter(
      (_, i) => assignments[i] === clusterIndex,
    );

    if (clusterPoints.length <= 1) return 0;

    let totalScore = 0;

    for (const point of clusterPoints) {
      const a = this.averageIntraClusterDistance(point, clusterPoints);
      const b = this.averageNearestClusterDistance(
        point,
        points,
        assignments,
        clusterIndex,
      );

      const silhouette = (b - a) / Math.max(a, b);
      totalScore += silhouette;
    }

    return totalScore / clusterPoints.length;
  }

  private averageIntraClusterDistance(
    point: Float32Array,
    clusterPoints: Float32Array[],
  ): number {
    if (clusterPoints.length <= 1) return 0;

    let totalDistance = 0;
    let count = 0;

    for (const other of clusterPoints) {
      if (other !== point) {
        totalDistance += this.euclideanDistance(point, other);
        count++;
      }
    }

    return count > 0 ? totalDistance / count : 0;
  }

  private averageNearestClusterDistance(
    point: Float32Array,
    allPoints: Float32Array[],
    assignments: number[],
    currentCluster: number,
  ): number {
    const otherClusters = new Set(
      assignments.filter((a) => a !== currentCluster),
    );
    let minAvgDistance = Infinity;

    for (const otherCluster of otherClusters) {
      const otherClusterPoints = allPoints.filter(
        (_, i) => assignments[i] === otherCluster,
      );

      if (otherClusterPoints.length > 0) {
        let totalDistance = 0;
        for (const other of otherClusterPoints) {
          totalDistance += this.euclideanDistance(point, other);
        }

        const avgDistance = totalDistance / otherClusterPoints.length;
        minAvgDistance = Math.min(minAvgDistance, avgDistance);
      }
    }

    return minAvgDistance;
  }

  // Dimensionality reduction methods (simplified implementations)
  private performPCA(
    points: Float32Array[],
    targetDimensions: number,
  ): {
    reducedPoints: Float32Array[];
    explainedVariance: number;
    components: Float32Array[];
  } {
    // Simplified PCA implementation
    const n = points.length;
    const d = points[0].length;

    // Center the data
    const mean = new Float32Array(d);
    for (const point of points) {
      for (let i = 0; i < d; i++) {
        mean[i] += point[i];
      }
    }
    for (let i = 0; i < d; i++) {
      mean[i] /= n;
    }

    const centeredPoints = points.map((point) => {
      const centered = new Float32Array(d);
      for (let i = 0; i < d; i++) {
        centered[i] = point[i] - mean[i];
      }
      return centered;
    });

    // For simplicity, just take the first targetDimensions
    const reducedPoints = centeredPoints.map((point) => {
      const reduced = new Float32Array(targetDimensions);
      for (let i = 0; i < targetDimensions; i++) {
        reduced[i] = point[i] || 0;
      }
      return reduced;
    });

    return {
      reducedPoints,
      explainedVariance: 0.8, // Placeholder
      components: [], // Placeholder
    };
  }

  private performTSNE(
    points: Float32Array[],
    targetDimensions: number,
  ): Float32Array[] {
    // Simplified t-SNE implementation (placeholder)
    return points.map((point) => {
      const reduced = new Float32Array(targetDimensions);
      for (let i = 0; i < targetDimensions; i++) {
        reduced[i] = (Math.random() - 0.5) * 2; // Random projection for now
      }
      return reduced;
    });
  }

  private performUMAP(
    points: Float32Array[],
    targetDimensions: number,
  ): Float32Array[] {
    // Simplified UMAP implementation (placeholder)
    return points.map((point) => {
      const reduced = new Float32Array(targetDimensions);
      for (let i = 0; i < targetDimensions; i++) {
        reduced[i] = (Math.random() - 0.5) * 2; // Random projection for now
      }
      return reduced;
    });
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.embeddingCache.clear();
    this.similarityCache.clear();
  }

  /**
   * Get embedding statistics
   */
  getEmbeddingStats(): {
    cacheSize: number;
    modelInfo: {
      word2vec: boolean;
      doc2vec: boolean;
      codeModel: boolean;
    };
    dimensions: number;
  } {
    return {
      cacheSize: this.embeddingCache.size,
      modelInfo: {
        word2vec: this.word2vecModel !== null,
        doc2vec: this.doc2vecModel !== null,
        codeModel: this.codeModel !== null,
      },
      dimensions: this.dimensions,
    };
  }
}
