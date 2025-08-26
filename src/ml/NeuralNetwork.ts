import type { EmbeddingVector } from "./RelevanceScorer.js";
import type { CombinedFeatures } from "./FeatureExtractor.js";

export interface NetworkLayer {
  weights: Float32Array[];
  biases: Float32Array;
  activation: "relu" | "sigmoid" | "tanh" | "softmax" | "linear";
  dropout?: number;
}

export interface NetworkArchitecture {
  inputSize: number;
  hiddenLayers: number[];
  outputSize: number;
  activations: string[];
  dropout?: number[];
}

export interface TrainingConfig {
  learningRate: number;
  batchSize: number;
  epochs: number;
  validationSplit: number;
  earlyStoppingPatience: number;
  l1Regularization: number;
  l2Regularization: number;
  momentum: number;
  adamBeta1: number;
  adamBeta2: number;
  adamEpsilon: number;
}

export interface TrainingData {
  inputs: Float32Array[];
  targets: Float32Array[];
  weights?: Float32Array;
}

export interface ValidationMetrics {
  loss: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  confusionMatrix: number[][];
}

export interface TrainingHistory {
  epoch: number;
  trainLoss: number;
  validationLoss: number;
  trainAccuracy: number;
  validationAccuracy: number;
  learningRate: number;
  timestamp: number;
}

export interface ModelCheckpoint {
  epoch: number;
  loss: number;
  accuracy: number;
  weights: Float32Array[][];
  biases: Float32Array[];
  timestamp: number;
}

export interface PredictionResult {
  prediction: Float32Array;
  confidence: number;
  probabilities?: Float32Array;
  features?: string[];
  explanation?: {
    topFeatures: Array<{ feature: string; importance: number }>;
    activations: Float32Array[];
  };
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  rank: number;
  category: "text" | "code" | "context" | "usage" | "semantic";
}

export class NeuralNetwork {
  private layers: NetworkLayer[] = [];
  private architecture: NetworkArchitecture;
  private config: TrainingConfig;
  private trainingHistory: TrainingHistory[] = [];
  private bestCheckpoint: ModelCheckpoint | null = null;
  private optimizer: "sgd" | "adam" | "rmsprop" = "adam";
  private adamM: Float32Array[][] = [];
  private adamV: Float32Array[][] = [];
  private adamT: number = 0;

  constructor(
    architecture: NetworkArchitecture,
    config: Partial<TrainingConfig> = {},
  ) {
    this.architecture = architecture;
    this.config = {
      learningRate: 0.001,
      batchSize: 32,
      epochs: 100,
      validationSplit: 0.2,
      earlyStoppingPatience: 10,
      l1Regularization: 0.0001,
      l2Regularization: 0.0001,
      momentum: 0.9,
      adamBeta1: 0.9,
      adamBeta2: 0.999,
      adamEpsilon: 1e-8,
      ...config,
    };

    this.initializeNetwork();
  }

  /**
   * Initialize network layers with random weights
   */
  private initializeNetwork(): void {
    const sizes = [
      this.architecture.inputSize,
      ...this.architecture.hiddenLayers,
      this.architecture.outputSize,
    ];

    for (let i = 0; i < sizes.length - 1; i++) {
      const inputSize = sizes[i];
      const outputSize = sizes[i + 1];
      const activation = this.architecture.activations[i] || "relu";
      const dropout = this.architecture.dropout?.[i];

      // Xavier/Glorot initialization
      const scale = Math.sqrt(2.0 / (inputSize + outputSize));
      const weights: Float32Array[] = [];

      for (let j = 0; j < outputSize; j++) {
        const neuronWeights = new Float32Array(inputSize);
        for (let k = 0; k < inputSize; k++) {
          neuronWeights[k] = (Math.random() - 0.5) * 2 * scale;
        }
        weights.push(neuronWeights);
      }

      const biases = new Float32Array(outputSize);
      // Small positive bias for ReLU
      if (activation === "relu") {
        biases.fill(0.01);
      }

      this.layers.push({
        weights,
        biases,
        activation: activation as any,
        dropout,
      });
    }

    // Initialize Adam optimizer state
    this.initializeAdam();
  }

  /**
   * Initialize Adam optimizer momentum and velocity
   */
  private initializeAdam(): void {
    this.adamM = [];
    this.adamV = [];

    for (const layer of this.layers) {
      const layerM: Float32Array[] = [];
      const layerV: Float32Array[] = [];

      for (const weights of layer.weights) {
        layerM.push(new Float32Array(weights.length));
        layerV.push(new Float32Array(weights.length));
      }

      this.adamM.push(layerM);
      this.adamV.push(layerV);
    }
  }

  /**
   * Forward pass through the network
   */
  forward(
    input: Float32Array,
    training: boolean = false,
  ): {
    output: Float32Array;
    activations: Float32Array[];
    preActivations: Float32Array[];
  } {
    let currentInput = input;
    const activations: Float32Array[] = [new Float32Array(input)];
    const preActivations: Float32Array[] = [];

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const preActivation = new Float32Array(layer.weights.length);

      // Linear transformation: z = Wx + b
      for (let j = 0; j < layer.weights.length; j++) {
        let sum = layer.biases[j];
        for (let k = 0; k < currentInput.length; k++) {
          sum += layer.weights[j][k] * currentInput[k];
        }
        preActivation[j] = sum;
      }

      preActivations.push(new Float32Array(preActivation));

      // Apply activation function
      const activation = this.applyActivation(preActivation, layer.activation);

      // Apply dropout during training
      if (training && layer.dropout && layer.dropout > 0) {
        this.applyDropout(activation, layer.dropout);
      }

      activations.push(new Float32Array(activation));
      currentInput = activation;
    }

    return {
      output: currentInput,
      activations,
      preActivations,
    };
  }

  /**
   * Backward pass (backpropagation)
   */
  private backward(
    input: Float32Array,
    target: Float32Array,
    forwardResult: {
      output: Float32Array;
      activations: Float32Array[];
      preActivations: Float32Array[];
    },
  ): { gradients: Float32Array[][]; biasGradients: Float32Array[] } {
    const { activations, preActivations } = forwardResult;
    const gradients: Float32Array[][] = [];
    const biasGradients: Float32Array[] = [];

    // Calculate output layer error
    let delta = this.calculateOutputError(forwardResult.output, target);

    // Backpropagate through layers
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      const layerInput = i === 0 ? input : activations[i];

      // Calculate gradients for weights
      const layerGradients: Float32Array[] = [];
      for (let j = 0; j < layer.weights.length; j++) {
        const neuronGradients = new Float32Array(layer.weights[j].length);
        for (let k = 0; k < layer.weights[j].length; k++) {
          neuronGradients[k] = delta[j] * layerInput[k];
        }
        layerGradients.push(neuronGradients);
      }
      gradients.unshift(layerGradients);

      // Calculate bias gradients
      biasGradients.unshift(new Float32Array(delta));

      // Calculate delta for previous layer
      if (i > 0) {
        const prevDelta = new Float32Array(layerInput.length);
        for (let j = 0; j < layerInput.length; j++) {
          let sum = 0;
          for (let k = 0; k < layer.weights.length; k++) {
            sum += delta[k] * layer.weights[k][j];
          }
          // Apply derivative of activation function
          const activationDerivative = this.getActivationDerivative(
            preActivations[i - 1][j],
            layer.activation,
          );
          prevDelta[j] = sum * activationDerivative;
        }
        delta = prevDelta;
      }
    }

    return { gradients, biasGradients };
  }

  /**
   * Train the network on provided data
   */
  async train(trainingData: TrainingData): Promise<TrainingHistory[]> {
    console.log("Starting neural network training...");

    // Split data into training and validation sets
    const { trainData, validationData } = this.splitData(trainingData);

    let bestValidationLoss = Infinity;
    let patienceCounter = 0;

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      console.log(`Epoch ${epoch + 1}/${this.config.epochs}`);

      // Shuffle training data
      this.shuffleData(trainData);

      // Train on batches
      const trainMetrics = await this.trainEpoch(trainData);

      // Validate
      const validationMetrics = this.validate(validationData);

      // Record history
      const history: TrainingHistory = {
        epoch: epoch + 1,
        trainLoss: trainMetrics.loss,
        validationLoss: validationMetrics.loss,
        trainAccuracy: trainMetrics.accuracy,
        validationAccuracy: validationMetrics.accuracy,
        learningRate: this.config.learningRate,
        timestamp: Date.now(),
      };

      this.trainingHistory.push(history);

      console.log(
        `Train Loss: ${trainMetrics.loss.toFixed(4)}, Val Loss: ${validationMetrics.loss.toFixed(4)}`,
      );
      console.log(
        `Train Acc: ${trainMetrics.accuracy.toFixed(4)}, Val Acc: ${validationMetrics.accuracy.toFixed(4)}`,
      );

      // Early stopping and checkpointing
      if (validationMetrics.loss < bestValidationLoss) {
        bestValidationLoss = validationMetrics.loss;
        patienceCounter = 0;
        this.saveCheckpoint(epoch + 1, validationMetrics);
      } else {
        patienceCounter++;
        if (patienceCounter >= this.config.earlyStoppingPatience) {
          console.log(`Early stopping at epoch ${epoch + 1}`);
          break;
        }
      }

      // Learning rate decay
      if (epoch > 0 && epoch % 20 === 0) {
        this.config.learningRate *= 0.9;
      }
    }

    // Restore best checkpoint
    if (this.bestCheckpoint) {
      this.loadCheckpoint(this.bestCheckpoint);
      console.log(
        `Restored best model from epoch ${this.bestCheckpoint.epoch}`,
      );
    }

    console.log("Training completed");
    return this.trainingHistory;
  }

  /**
   * Train for one epoch
   */
  private async trainEpoch(
    trainData: TrainingData,
  ): Promise<ValidationMetrics> {
    let totalLoss = 0;
    let correct = 0;
    let total = 0;

    const batchSize = this.config.batchSize;
    const numBatches = Math.ceil(trainData.inputs.length / batchSize);

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const startIdx = batchIdx * batchSize;
      const endIdx = Math.min(startIdx + batchSize, trainData.inputs.length);

      const batchInputs = trainData.inputs.slice(startIdx, endIdx);
      const batchTargets = trainData.targets.slice(startIdx, endIdx);
      const batchWeights = trainData.weights?.slice(startIdx, endIdx);

      // Accumulate gradients for batch
      const accumulatedGradients: Float32Array[][] = [];
      const accumulatedBiasGradients: Float32Array[] = [];
      let batchLoss = 0;

      for (let i = 0; i < batchInputs.length; i++) {
        const input = batchInputs[i];
        const target = batchTargets[i];
        const weight = batchWeights?.[i] || 1.0;

        // Forward pass
        const forwardResult = this.forward(input, true);

        // Calculate loss
        const loss = this.calculateLoss(forwardResult.output, target) * weight;
        batchLoss += loss;

        // Backward pass
        const { gradients, biasGradients } = this.backward(
          input,
          target,
          forwardResult,
        );

        // Accumulate gradients
        if (i === 0) {
          for (let j = 0; j < gradients.length; j++) {
            accumulatedGradients[j] = gradients[j].map(
              (g) => new Float32Array(g),
            );
            accumulatedBiasGradients[j] = new Float32Array(biasGradients[j]);
          }
        } else {
          for (let j = 0; j < gradients.length; j++) {
            for (let k = 0; k < gradients[j].length; k++) {
              for (let l = 0; l < gradients[j][k].length; l++) {
                accumulatedGradients[j][k][l] += gradients[j][k][l] * weight;
              }
            }
            for (let k = 0; k < biasGradients[j].length; k++) {
              accumulatedBiasGradients[j][k] += biasGradients[j][k] * weight;
            }
          }
        }

        // Calculate accuracy
        const predicted = this.getPredictedClass(forwardResult.output);
        const actual = this.getPredictedClass(target);
        if (predicted === actual) correct++;
        total++;
      }

      // Average gradients
      for (let j = 0; j < accumulatedGradients.length; j++) {
        for (let k = 0; k < accumulatedGradients[j].length; k++) {
          for (let l = 0; l < accumulatedGradients[j][k].length; l++) {
            accumulatedGradients[j][k][l] /= batchInputs.length;
          }
        }
        for (let k = 0; k < accumulatedBiasGradients[j].length; k++) {
          accumulatedBiasGradients[j][k] /= batchInputs.length;
        }
      }

      // Update weights
      this.updateWeights(accumulatedGradients, accumulatedBiasGradients);

      totalLoss += batchLoss / batchInputs.length;
    }

    return {
      loss: totalLoss / numBatches,
      accuracy: correct / total,
      precision: 0, // Placeholder
      recall: 0, // Placeholder
      f1Score: 0, // Placeholder
      auc: 0, // Placeholder
      confusionMatrix: [], // Placeholder
    };
  }

  /**
   * Validate the network
   */
  private validate(validationData: TrainingData): ValidationMetrics {
    let totalLoss = 0;
    let correct = 0;
    const predictions: number[] = [];
    const actuals: number[] = [];

    for (let i = 0; i < validationData.inputs.length; i++) {
      const input = validationData.inputs[i];
      const target = validationData.targets[i];

      const forwardResult = this.forward(input, false);
      const loss = this.calculateLoss(forwardResult.output, target);
      totalLoss += loss;

      const predicted = this.getPredictedClass(forwardResult.output);
      const actual = this.getPredictedClass(target);

      predictions.push(predicted);
      actuals.push(actual);

      if (predicted === actual) correct++;
    }

    const accuracy = correct / validationData.inputs.length;
    const { precision, recall, f1Score, confusionMatrix } =
      this.calculateDetailedMetrics(predictions, actuals);

    return {
      loss: totalLoss / validationData.inputs.length,
      accuracy,
      precision,
      recall,
      f1Score,
      auc: 0, // Placeholder
      confusionMatrix,
    };
  }

  /**
   * Make prediction on new input
   */
  predict(
    input: Float32Array,
    explainPrediction: boolean = false,
  ): PredictionResult {
    const forwardResult = this.forward(input, false);
    const prediction = forwardResult.output;

    // Calculate confidence
    const confidence = this.calculateConfidence(prediction);

    // Calculate probabilities for classification
    let probabilities: Float32Array | undefined;
    if (this.architecture.outputSize > 1) {
      probabilities = this.softmax(prediction);
    }

    let explanation: PredictionResult["explanation"];
    if (explainPrediction) {
      explanation = this.explainPrediction(input, forwardResult);
    }

    return {
      prediction,
      confidence,
      probabilities,
      explanation,
    };
  }

  /**
   * Batch prediction
   */
  predictBatch(inputs: Float32Array[]): PredictionResult[] {
    return inputs.map((input) => this.predict(input));
  }

  /**
   * Calculate feature importance using gradient-based method
   */
  calculateFeatureImportance(
    inputs: Float32Array[],
    featureNames: string[],
  ): FeatureImportance[] {
    const importances = new Float32Array(this.architecture.inputSize);

    for (const input of inputs) {
      const forwardResult = this.forward(input, false);

      // Calculate gradients with respect to input
      const inputGradients = this.calculateInputGradients(input, forwardResult);

      // Accumulate absolute gradients
      for (let i = 0; i < inputGradients.length; i++) {
        importances[i] += Math.abs(inputGradients[i]);
      }
    }

    // Normalize by number of samples
    for (let i = 0; i < importances.length; i++) {
      importances[i] /= inputs.length;
    }

    // Create feature importance objects
    const featureImportanceList: FeatureImportance[] = [];
    for (let i = 0; i < importances.length; i++) {
      featureImportanceList.push({
        feature: featureNames[i] || `feature_${i}`,
        importance: importances[i],
        rank: 0, // Will be set after sorting
        category: this.categorizeFeature(featureNames[i] || `feature_${i}`),
      });
    }

    // Sort by importance and assign ranks
    featureImportanceList.sort((a, b) => b.importance - a.importance);
    featureImportanceList.forEach((item, index) => {
      item.rank = index + 1;
    });

    return featureImportanceList;
  }

  /**
   * Export model weights and architecture
   */
  exportModel(): {
    architecture: NetworkArchitecture;
    weights: number[][][];
    biases: number[][];
    config: TrainingConfig;
    history: TrainingHistory[];
  } {
    return {
      architecture: this.architecture,
      weights: this.layers.map((layer) =>
        layer.weights.map((w) => Array.from(w)),
      ),
      biases: this.layers.map((layer) => Array.from(layer.biases)),
      config: this.config,
      history: this.trainingHistory,
    };
  }

  /**
   * Import model weights and architecture
   */
  importModel(modelData: {
    architecture: NetworkArchitecture;
    weights: number[][][];
    biases: number[][];
    config: TrainingConfig;
    history: TrainingHistory[];
  }): void {
    this.architecture = modelData.architecture;
    this.config = modelData.config;
    this.trainingHistory = modelData.history;

    // Reconstruct layers
    this.layers = [];
    for (let i = 0; i < modelData.weights.length; i++) {
      const weights = modelData.weights[i].map((w) => new Float32Array(w));
      const biases = new Float32Array(modelData.biases[i]);
      const activation = this.architecture.activations[i] || "relu";
      const dropout = this.architecture.dropout?.[i];

      this.layers.push({
        weights,
        biases,
        activation: activation as any,
        dropout,
      });
    }

    // Reinitialize optimizer state
    this.initializeAdam();
  }

  // Private helper methods
  private applyActivation(
    input: Float32Array,
    activation: string,
  ): Float32Array {
    const output = new Float32Array(input.length);

    switch (activation) {
      case "relu":
        for (let i = 0; i < input.length; i++) {
          output[i] = Math.max(0, input[i]);
        }
        break;

      case "sigmoid":
        for (let i = 0; i < input.length; i++) {
          output[i] = 1 / (1 + Math.exp(-input[i]));
        }
        break;

      case "tanh":
        for (let i = 0; i < input.length; i++) {
          output[i] = Math.tanh(input[i]);
        }
        break;

      case "softmax":
        return this.softmax(input);

      case "linear":
      default:
        for (let i = 0; i < input.length; i++) {
          output[i] = input[i];
        }
        break;
    }

    return output;
  }

  private softmax(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    const max = Math.max(...input);
    let sum = 0;

    // Subtract max for numerical stability
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.exp(input[i] - max);
      sum += output[i];
    }

    // Normalize
    for (let i = 0; i < input.length; i++) {
      output[i] /= sum;
    }

    return output;
  }

  private getActivationDerivative(input: number, activation: string): number {
    switch (activation) {
      case "relu":
        return input > 0 ? 1 : 0;

      case "sigmoid":
        const sigmoid = 1 / (1 + Math.exp(-input));
        return sigmoid * (1 - sigmoid);

      case "tanh":
        const tanh = Math.tanh(input);
        return 1 - tanh * tanh;

      case "linear":
      default:
        return 1;
    }
  }

  private applyDropout(activation: Float32Array, dropoutRate: number): void {
    for (let i = 0; i < activation.length; i++) {
      if (Math.random() < dropoutRate) {
        activation[i] = 0;
      } else {
        activation[i] /= 1 - dropoutRate; // Scale to maintain expected value
      }
    }
  }

  private calculateOutputError(
    output: Float32Array,
    target: Float32Array,
  ): Float32Array {
    const error = new Float32Array(output.length);

    // Mean squared error derivative
    for (let i = 0; i < output.length; i++) {
      error[i] = (2 * (output[i] - target[i])) / output.length;
    }

    return error;
  }

  private calculateLoss(output: Float32Array, target: Float32Array): number {
    let loss = 0;

    // Mean squared error
    for (let i = 0; i < output.length; i++) {
      const diff = output[i] - target[i];
      loss += diff * diff;
    }

    loss /= output.length;

    // Add regularization
    loss += this.calculateRegularization();

    return loss;
  }

  private calculateRegularization(): number {
    let l1 = 0;
    let l2 = 0;

    for (const layer of this.layers) {
      for (const weights of layer.weights) {
        for (const weight of weights) {
          l1 += Math.abs(weight);
          l2 += weight * weight;
        }
      }
    }

    return (
      this.config.l1Regularization * l1 + this.config.l2Regularization * l2
    );
  }

  private updateWeights(
    gradients: Float32Array[][],
    biasGradients: Float32Array[],
  ): void {
    this.adamT++;

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const layerGradients = gradients[i];
      const layerBiasGradients = biasGradients[i];

      // Update weights
      for (let j = 0; j < layer.weights.length; j++) {
        for (let k = 0; k < layer.weights[j].length; k++) {
          const gradient =
            layerGradients[j][k] +
            this.config.l1Regularization * Math.sign(layer.weights[j][k]) +
            this.config.l2Regularization * layer.weights[j][k];

          if (this.optimizer === "adam") {
            this.updateWeightAdam(i, j, k, gradient);
          } else {
            layer.weights[j][k] -= this.config.learningRate * gradient;
          }
        }
      }

      // Update biases
      for (let j = 0; j < layer.biases.length; j++) {
        layer.biases[j] -= this.config.learningRate * layerBiasGradients[j];
      }
    }
  }

  private updateWeightAdam(
    layerIdx: number,
    neuronIdx: number,
    weightIdx: number,
    gradient: number,
  ): void {
    const m = this.adamM[layerIdx][neuronIdx];
    const v = this.adamV[layerIdx][neuronIdx];
    const weight = this.layers[layerIdx].weights[neuronIdx];

    // Update biased first moment estimate
    m[weightIdx] =
      this.config.adamBeta1 * m[weightIdx] +
      (1 - this.config.adamBeta1) * gradient;

    // Update biased second raw moment estimate
    v[weightIdx] =
      this.config.adamBeta2 * v[weightIdx] +
      (1 - this.config.adamBeta2) * gradient * gradient;

    // Compute bias-corrected first moment estimate
    const mHat =
      m[weightIdx] / (1 - Math.pow(this.config.adamBeta1, this.adamT));

    // Compute bias-corrected second raw moment estimate
    const vHat =
      v[weightIdx] / (1 - Math.pow(this.config.adamBeta2, this.adamT));

    // Update weight
    weight[weightIdx] -=
      (this.config.learningRate * mHat) /
      (Math.sqrt(vHat) + this.config.adamEpsilon);
  }

  private splitData(data: TrainingData): {
    trainData: TrainingData;
    validationData: TrainingData;
  } {
    const totalSamples = data.inputs.length;
    const validationSize = Math.floor(
      totalSamples * this.config.validationSplit,
    );
    const trainSize = totalSamples - validationSize;

    // Shuffle indices
    const indices = Array.from({ length: totalSamples }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const trainIndices = indices.slice(0, trainSize);
    const validationIndices = indices.slice(trainSize);

    return {
      trainData: {
        inputs: trainIndices.map((i) => data.inputs[i]),
        targets: trainIndices.map((i) => data.targets[i]),
        weights: data.weights
          ? trainIndices.map((i) => data.weights![i])
          : undefined,
      },
      validationData: {
        inputs: validationIndices.map((i) => data.inputs[i]),
        targets: validationIndices.map((i) => data.targets[i]),
        weights: data.weights
          ? validationIndices.map((i) => data.weights![i])
          : undefined,
      },
    };
  }

  private shuffleData(data: TrainingData): void {
    const indices = Array.from({ length: data.inputs.length }, (_, i) => i);

    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const shuffledInputs = indices.map((i) => data.inputs[i]);
    const shuffledTargets = indices.map((i) => data.targets[i]);
    const shuffledWeights = data.weights
      ? indices.map((i) => data.weights![i])
      : undefined;

    data.inputs.splice(0, data.inputs.length, ...shuffledInputs);
    data.targets.splice(0, data.targets.length, ...shuffledTargets);
    if (data.weights && shuffledWeights) {
      data.weights.splice(0, data.weights.length, ...shuffledWeights);
    }
  }

  private getPredictedClass(output: Float32Array): number {
    if (output.length === 1) {
      return output[0] > 0.5 ? 1 : 0;
    } else {
      let maxIndex = 0;
      for (let i = 1; i < output.length; i++) {
        if (output[i] > output[maxIndex]) {
          maxIndex = i;
        }
      }
      return maxIndex;
    }
  }

  private calculateConfidence(prediction: Float32Array): number {
    if (prediction.length === 1) {
      return Math.abs(prediction[0] - 0.5) * 2;
    } else {
      const probabilities = this.softmax(prediction);
      return Math.max(...probabilities);
    }
  }

  private calculateDetailedMetrics(
    predictions: number[],
    actuals: number[],
  ): {
    precision: number;
    recall: number;
    f1Score: number;
    confusionMatrix: number[][];
  } {
    const numClasses = Math.max(...predictions, ...actuals) + 1;
    const confusionMatrix = Array(numClasses)
      .fill(0)
      .map(() => Array(numClasses).fill(0));

    // Build confusion matrix
    for (let i = 0; i < predictions.length; i++) {
      confusionMatrix[actuals[i]][predictions[i]]++;
    }

    // Calculate precision, recall, and F1 for each class
    let totalPrecision = 0;
    let totalRecall = 0;
    let validClasses = 0;

    for (let i = 0; i < numClasses; i++) {
      const tp = confusionMatrix[i][i];
      const fp = confusionMatrix.reduce(
        (sum, row, j) => sum + (j !== i ? row[i] : 0),
        0,
      );
      const fn = confusionMatrix[i].reduce(
        (sum, val, j) => sum + (j !== i ? val : 0),
        0,
      );

      if (tp + fp > 0) {
        totalPrecision += tp / (tp + fp);
        validClasses++;
      }

      if (tp + fn > 0) {
        totalRecall += tp / (tp + fn);
      }
    }

    const precision = validClasses > 0 ? totalPrecision / validClasses : 0;
    const recall = validClasses > 0 ? totalRecall / validClasses : 0;
    const f1Score =
      precision + recall > 0
        ? (2 * (precision * recall)) / (precision + recall)
        : 0;

    return { precision, recall, f1Score, confusionMatrix };
  }

  private saveCheckpoint(epoch: number, metrics: ValidationMetrics): void {
    this.bestCheckpoint = {
      epoch,
      loss: metrics.loss,
      accuracy: metrics.accuracy,
      weights: this.layers.map((layer) =>
        layer.weights.map((w) => new Float32Array(w)),
      ),
      biases: this.layers.map((layer) => new Float32Array(layer.biases)),
      timestamp: Date.now(),
    };
  }

  private loadCheckpoint(checkpoint: ModelCheckpoint): void {
    for (let i = 0; i < this.layers.length; i++) {
      for (let j = 0; j < this.layers[i].weights.length; j++) {
        this.layers[i].weights[j] = new Float32Array(checkpoint.weights[i][j]);
      }
      this.layers[i].biases = new Float32Array(checkpoint.biases[i]);
    }
  }

  private explainPrediction(
    input: Float32Array,
    forwardResult: {
      output: Float32Array;
      activations: Float32Array[];
      preActivations: Float32Array[];
    },
  ): PredictionResult["explanation"] {
    // Calculate input gradients for feature importance
    const inputGradients = this.calculateInputGradients(input, forwardResult);

    // Get top contributing features
    const featureImportances = inputGradients.map((grad, i) => ({
      feature: `feature_${i}`,
      importance: Math.abs(grad),
    }));

    featureImportances.sort((a, b) => b.importance - a.importance);
    const topFeatures = featureImportances.slice(0, 10);

    return {
      topFeatures,
      activations: forwardResult.activations,
    };
  }

  private calculateInputGradients(
    input: Float32Array,
    forwardResult: {
      output: Float32Array;
      activations: Float32Array[];
      preActivations: Float32Array[];
    },
  ): Float32Array {
    // Simplified gradient calculation with respect to input
    const inputGradients = new Float32Array(input.length);

    // For each input feature, calculate how much it contributes to the output
    for (let i = 0; i < input.length; i++) {
      let gradient = 0;

      // Sum contributions through first layer
      for (let j = 0; j < this.layers[0].weights.length; j++) {
        gradient += this.layers[0].weights[j][i] * forwardResult.output[0];
      }

      inputGradients[i] = gradient;
    }

    return inputGradients;
  }

  private categorizeFeature(
    featureName: string,
  ): "text" | "code" | "context" | "usage" | "semantic" {
    if (
      featureName.includes("text") ||
      featureName.includes("word") ||
      featureName.includes("token")
    ) {
      return "text";
    } else if (
      featureName.includes("code") ||
      featureName.includes("ast") ||
      featureName.includes("syntax")
    ) {
      return "code";
    } else if (
      featureName.includes("context") ||
      featureName.includes("scope") ||
      featureName.includes("file")
    ) {
      return "context";
    } else if (
      featureName.includes("usage") ||
      featureName.includes("frequency") ||
      featureName.includes("count")
    ) {
      return "usage";
    } else {
      return "semantic";
    }
  }

  /**
   * Get training history
   */
  getTrainingHistory(): TrainingHistory[] {
    return this.trainingHistory;
  }

  /**
   * Get network architecture
   */
  getArchitecture(): NetworkArchitecture {
    return this.architecture;
  }

  /**
   * Get training configuration
   */
  getConfig(): TrainingConfig {
    return this.config;
  }

  /**
   * Reset the network (reinitialize weights)
   */
  reset(): void {
    this.initializeNetwork();
    this.trainingHistory = [];
    this.bestCheckpoint = null;
    this.adamT = 0;
  }
}
