/**
 * Seeded random number generator for deterministic output
 * Uses Linear Congruential Generator (LCG) algorithm
 * This ensures reproducible data generation for testing and demos
 */

/**
 * Create a seeded random number generator
 * @param {number} seed - Initial seed value
 * @returns {function} Random number generator function that returns values between 0 and 1
 */
export function seedRandom(seed) {
  let state = seed;

  return function() {
    // LCG parameters (same as Java's java.util.Random for consistency)
    // multiplier = 1103515245, increment = 12345, modulus = 2^31
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Create a seeded random integer generator
 * @param {number} seed - Initial seed value
 * @returns {function} Random integer generator function
 */
export function seedRandomInt(seed) {
  const random = seedRandom(seed);

  return function(min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
  };
}

/**
 * Create a seeded random choice selector
 * @param {number} seed - Initial seed value
 * @returns {function} Function that randomly selects from array
 */
export function seedRandomChoice(seed) {
  const random = seedRandom(seed);

  return function(array) {
    if (!array || array.length === 0) return null;
    const index = Math.floor(random() * array.length);
    return array[index];
  };
}

/**
 * SeededRandom class for convenient use in generators
 * Provides all random utilities with a single seed
 */
export class SeededRandom {
  constructor(seed) {
    this.seed = seed;
    this.state = seed;
  }

  /**
   * Get next random float between 0 and 1
   */
  next() {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  /**
   * Get random float between min and max
   */
  nextFloat(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  /**
   * Get random integer between min and max (inclusive)
   */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Choose random item from array
   */
  choice(array) {
    if (!array || array.length === 0) return null;
    const index = Math.floor(this.next() * array.length);
    return array[index];
  }

  /**
   * Reset to original seed
   */
  reset() {
    this.state = this.seed;
  }
}

/**
 * Create a seeded random boolean generator
 * @param {number} seed - Initial seed value
 * @returns {function} Random boolean generator with optional probability
 */
export function seedRandomBoolean(seed) {
  const random = seedRandom(seed);

  return function(probability = 0.5) {
    return random() < probability;
  };
}

export default {
  seedRandom,
  seedRandomInt,
  seedRandomChoice,
  seedRandomBoolean
};