/**
 * Utility: Delete ACO Products by SKU List
 * 
 * Deletes a list of products from ACO by their SKUs.
 * Useful for manual cleanup operations when you have a specific list of SKUs to remove.
 * 
 * Usage:
 *   node aco/utils/delete-by-sku-list.js /path/to/skus.json
 * 
 * SKUs file format:
 *   ["SKU1", "SKU2", "SKU3"]
 */

import { deleteProductsBySKUs } from '../lib/aco-delete.js';
import { readFile } from 'fs/promises';
import chalk from 'chalk';

async function deleteBySkuList(skuFilePath) {
  console.log(chalk.blue('🗑️  ACO Product Deletion by SKU List'));
  console.log();
  
  // Read SKU list from file
  const skuData = await readFile(skuFilePath, 'utf-8');
  const skus = JSON.parse(skuData);
  
  if (!Array.isArray(skus)) {
    throw new Error('SKU file must contain a JSON array of SKU strings');
  }
  
  console.log(`📋 Loaded ${skus.length} SKUs from ${skuFilePath}`);
  console.log();
  
  // Delete products
  const result = await deleteProductsBySKUs(skus);
  
  console.log();
  console.log(chalk.green(`✅ Deleted ${result.deleted} products`));
  if (result.notFound > 0) {
    console.log(chalk.yellow(`⚠️  ${result.notFound} SKUs not found`));
  }
}

// Get SKU file path from command line
const skuFilePath = process.argv[2];
if (!skuFilePath) {
  console.error(chalk.red('Error: SKU file path is required'));
  console.log();
  console.log('Usage:');
  console.log('  node aco/utils/delete-by-sku-list.js /path/to/skus.json');
  console.log();
  console.log('SKU file format:');
  console.log('  ["SKU1", "SKU2", "SKU3"]');
  process.exit(1);
}

deleteBySkuList(skuFilePath).catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});

