#!/usr/bin/env node

/**
 * Generate BuildRight Service Data Files
 * 
 * Transforms ACO template data into the format needed by buildright-service.
 * 
 * This script:
 * 1. Reads template/variant/package data from buildright-aco/output/buildright/
 * 2. Transforms to service format (currently 1:1, but allows future transformations)
 * 3. Writes to buildright-service/lib/data/
 * 
 * Output files:
 * - templates.json: House templates for BOM generation
 * - variants.json: Template variants (bonus rooms, garage options, etc.)
 * - packages.json: Material packages (Builder's Choice, Desert Ridge Premium, etc.)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger('generate-service-data');

// Paths
const ACO_DATA_DIR = path.join(__dirname, '../data/buildright');
const SERVICE_OUTPUT_DIR = path.join(__dirname, '../../buildright-service/lib/data');

/**
 * Transform templates to service format
 * Currently 1:1 mapping, but allows for future transformations
 */
function generateServiceTemplates() {
  logger.info('Generating service templates from ACO data...');
  
  const acoTemplatesPath = path.join(ACO_DATA_DIR, 'templates.json');
  
  if (!fs.existsSync(acoTemplatesPath)) {
    logger.warn('templates.json not found in ACO data.');
    return null;
  }
  
  const acoTemplates = JSON.parse(fs.readFileSync(acoTemplatesPath, 'utf-8'));
  
  // Convert array to object keyed by ID for service lookup
  const serviceTemplates = {};
  acoTemplates.forEach(template => {
    serviceTemplates[template.id] = template;
  });
  
  logger.info(`Transformed ${acoTemplates.length} templates to service format`);
  return serviceTemplates;
}

/**
 * Transform variants to service format
 */
function generateServiceVariants() {
  logger.info('Generating service variants from ACO data...');
  
  const acoVariantsPath = path.join(ACO_DATA_DIR, 'template-variants.json');
  
  if (!fs.existsSync(acoVariantsPath)) {
    logger.warn('template-variants.json not found in ACO data.');
    return null;
  }
  
  const acoVariants = JSON.parse(fs.readFileSync(acoVariantsPath, 'utf-8'));
  
  // Convert array to object keyed by ID for service lookup
  const serviceVariants = {};
  acoVariants.forEach(variant => {
    serviceVariants[variant.id] = variant;
  });
  
  logger.info(`Transformed ${acoVariants.length} variants to service format`);
  return serviceVariants;
}

/**
 * Transform packages to service format
 */
function generateServicePackages() {
  logger.info('Generating service packages from ACO data...');
  
  const acoPackagesPath = path.join(ACO_DATA_DIR, 'material-packages.json');
  
  if (!fs.existsSync(acoPackagesPath)) {
    logger.warn('material-packages.json not found in ACO data.');
    return null;
  }
  
  const acoPackages = JSON.parse(fs.readFileSync(acoPackagesPath, 'utf-8'));
  
  // Convert array to object keyed by ID for service lookup
  const servicePackages = {};
  acoPackages.forEach(pkg => {
    servicePackages[pkg.id] = pkg;
  });
  
  logger.info(`Transformed ${acoPackages.length} packages to service format`);
  return servicePackages;
}

/**
 * Transform BOM product criteria to service format
 * This defines what product attributes to search for in ACO
 */
function generateBOMProductCriteria() {
  logger.info('Generating BOM product criteria from ACO data...');
  
  const acoCriteriaPath = path.join(ACO_DATA_DIR, 'bom-product-criteria.json');
  
  if (!fs.existsSync(acoCriteriaPath)) {
    logger.warn('bom-product-criteria.json not found in ACO data.');
    return null;
  }
  
  const acoCriteria = JSON.parse(fs.readFileSync(acoCriteriaPath, 'utf-8'));
  
  // Validate criteria structure
  const phaseCount = Object.keys(acoCriteria).length;
  let totalCriteria = 0;
  Object.values(acoCriteria).forEach(phase => {
    totalCriteria += Object.keys(phase).length;
  });
  
  logger.info(`Transformed BOM criteria: ${phaseCount} phases, ${totalCriteria} product types`);
  return acoCriteria;
}

/**
 * Main generation function
 */
async function main() {
  try {
    logger.info('Starting BuildRight Service data generation...');
    logger.info(`ACO Data Directory: ${ACO_DATA_DIR}`);
    logger.info(`Service Output Directory: ${SERVICE_OUTPUT_DIR}`);
    
    // Ensure output directory exists
    if (!fs.existsSync(SERVICE_OUTPUT_DIR)) {
      fs.mkdirSync(SERVICE_OUTPUT_DIR, { recursive: true });
      logger.info('Created service data directory');
    }
    
    // Generate templates
    const templates = generateServiceTemplates();
    if (templates) {
      const templatesPath = path.join(SERVICE_OUTPUT_DIR, 'templates.json');
      fs.writeFileSync(templatesPath, JSON.stringify(templates, null, 2));
      logger.info(`✓ Wrote templates.json (${Object.keys(templates).length} templates)`);
    }
    
    // Generate variants
    const variants = generateServiceVariants();
    if (variants) {
      const variantsPath = path.join(SERVICE_OUTPUT_DIR, 'variants.json');
      fs.writeFileSync(variantsPath, JSON.stringify(variants, null, 2));
      logger.info(`✓ Wrote variants.json (${Object.keys(variants).length} variants)`);
    }
    
    // Generate packages
    const packages = generateServicePackages();
    if (packages) {
      const packagesPath = path.join(SERVICE_OUTPUT_DIR, 'packages.json');
      fs.writeFileSync(packagesPath, JSON.stringify(packages, null, 2));
      logger.info(`✓ Wrote packages.json (${Object.keys(packages).length} packages)`);
    }
    
    // Generate BOM product criteria
    const bomCriteria = generateBOMProductCriteria();
    if (bomCriteria) {
      const criteriaPath = path.join(SERVICE_OUTPUT_DIR, 'bom-product-criteria.json');
      fs.writeFileSync(criteriaPath, JSON.stringify(bomCriteria, null, 2));
      logger.info(`✓ Wrote bom-product-criteria.json`);
    }
    
    logger.info('');
    logger.info('✓ BuildRight Service data generation complete!');
    logger.info('');
    logger.info('Generated files:');
    logger.info(`  - ${path.relative(process.cwd(), path.join(SERVICE_OUTPUT_DIR, 'templates.json'))}`);
    logger.info(`  - ${path.relative(process.cwd(), path.join(SERVICE_OUTPUT_DIR, 'variants.json'))}`);
    logger.info(`  - ${path.relative(process.cwd(), path.join(SERVICE_OUTPUT_DIR, 'packages.json'))}`);
    logger.info(`  - ${path.relative(process.cwd(), path.join(SERVICE_OUTPUT_DIR, 'bom-product-criteria.json'))}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Review generated files in buildright-service/lib/data/');
    logger.info('  2. Deploy buildright-service to use the new data');
    
  } catch (error) {
    logger.error('Error generating service data:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateServiceTemplates, generateServiceVariants, generateServicePackages, generateBOMProductCriteria };

