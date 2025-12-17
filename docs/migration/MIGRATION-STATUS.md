# 3-Repo Architecture Migration Status

## Overview

The buildright-commerce repository has been split into three independent repositories as per the architecture plan:

1. **commerce-demo-generator** - Generic datapack generation tool
2. **buildright-data** - BuildRight demo data (definitions + generated artifacts)
3. **commerce-demo-ingestion** - Generic ingestion tool for Commerce and ACO

## Completed ✅

### Phase 1: commerce-demo-generator (STRUCTURE COMPLETE)

**Created:**
- ✅ Repository structure with `config/`, `scripts/generators/`, `scripts/utils/`
- ✅ `package.json` with generation scripts
- ✅ `.env.example` for configuration
- ✅ Comprehensive `README.md`
- ✅ `config/project-config.js` - Dynamic config loader
- ✅ `.gitignore`
- ✅ Initial git commit

**Files Copied:**
- ✅ All generator scripts from buildright-commerce
- ✅ All utility files (description-generator, name-normalizer, etc.)
- ✅ BuildRight data to `config/sample-data/` as reference

### Phase 2: buildright-data (COMPLETE)

**Created:**
- ✅ Repository structure with `definitions/`, `media/`, `generated/`
- ✅ `definitions/project.json` - BuildRight project configuration
- ✅ Comprehensive `README.md`
- ✅ `.gitignore`
- ✅ Initial git commit

**Files Copied:**
- ✅ All source data from `buildright-commerce/data/` to `definitions/`
- ✅ Product images to `media/images/products/`
- ✅ Generated Commerce datapack to `generated/commerce/`
- ✅ Generated ACO format to `generated/aco/`

### Phase 3: commerce-demo-ingestion (STRUCTURE COMPLETE)

**Created:**
- ✅ Repository structure with `commerce/`, `aco/`, `shared/`
- ✅ `package.json` with import/delete scripts
- ✅ `.env.example` with all configuration
- ✅ Comprehensive `README.md`
- ✅ `.gitignore`
- ✅ Initial git commit

**Files Copied:**
- ✅ All Commerce import scripts from buildright-commerce
- ✅ All shared utilities (base-importer, commerce-api, etc.)
- ✅ ACO import/delete scripts from buildright-aco

## Remaining Work ⚠️

### commerce-demo-generator

**Critical Updates Needed:**

1. **Update all generator scripts** to use `PROJECT_CONFIG` instead of `COMMERCE_CONFIG`:
   - `scripts/generators/generate-commerce.js` (628 lines)
   - `scripts/generators/generate-aco.js`
   - `scripts/generators/products.js`
   - `scripts/generators/product-variants.js`
   - `scripts/generators/categories.js`
   - `scripts/generators/stores.js`
   - `scripts/generators/attributes.js`
   - `scripts/generators/customers.js`
   - `scripts/generators/customer-groups.js`

2. **Replace hardcoded values:**
   - `'buildright-datapack'` → `PROJECT_CONFIG.paths.outputCommerce`
   - `'br_'` → `PROJECT_CONFIG.project.attributePrefix`
   - `'BuildRight Catalog'` → `PROJECT_CONFIG.project.rootCategoryName`
   - Hardcoded image paths → `PROJECT_CONFIG.paths.media`

3. **Update imports:**
   - Change `#config/commerce-config` → `../../config/project-config.js`
   - Change `#shared/*` → `../utils/*`
   - Update cross-references between generator files

4. **Test generation:**
   ```bash
   cd commerce-demo-generator
   npm install
   npm run generate:commerce -- --data-repo=../buildright-data
   npm run generate:aco -- --data-repo=../buildright-data
   ```

### commerce-demo-ingestion

**Critical Updates Needed:**

1. **Update all import scripts** to read from data repository:
   ```javascript
   // Current:
   const DATAPACK_PATH = resolve(__dirname, '../output/buildright-datapack/...');
   
   // Should be:
   const DATA_REPO = process.env.DATA_REPO_PATH || '../buildright-data';
   const DATAPACK_PATH = resolve(DATA_REPO, 'generated/commerce/...');
   ```

2. **Update imports in all files:**
   - Change `#shared/*` → `../../shared/*`
   - Change `#config/*` → Read from data repo's `definitions/project.json`
   - Update cross-references

3. **Create config loader:**
   - Create `shared/config-loader.js` to read `definitions/project.json` from data repo
   - Update all scripts to use this loader

4. **Update state-tracker path:**
   - Change `.buildright-state` to use `PROJECT_IDENTIFIER` from config
   - Make it dynamic: `.${project.identifier}-state`

5. **Test ingestion:**
   ```bash
   cd commerce-demo-ingestion
   npm install
   # Configure .env with Commerce/ACO credentials
   npm run import:commerce
   npm run import:aco
   ```

### buildright-data

**No code changes needed** - This repo is complete and ready to use.

## Repository Locations

```
/Users/kukla/Documents/Repositories/app-builder/adobe-demo-system/
├── commerce-demo-generator/     # New - Generic generator
├── buildright-data/              # New - BuildRight data
├── commerce-demo-ingestion/     # New - Generic ingestion
├── buildright-commerce/          # Original - Keep for reference
├── buildright-aco/               # Original - Keep for ACO specific config
└── buildright-eds/               # Separate - EDS implementation
```

## Testing Strategy

### 1. Test Generator (commerce-demo-generator)

After updating generator scripts:

```bash
cd commerce-demo-generator
npm install

# Test Commerce generation
npm run generate:commerce -- --data-repo=../buildright-data

# Verify output in buildright-data/generated/commerce/

# Test ACO generation
npm run generate:aco -- --data-repo=../buildright-data

# Verify output in buildright-data/generated/aco/
```

### 2. Test Ingestion (commerce-demo-ingestion)

After updating ingestion scripts:

```bash
cd commerce-demo-ingestion
npm install
cp .env.example .env

# Edit .env with Commerce credentials
# Set DATA_REPO_PATH=../buildright-data

# Test Commerce import
npm run import:commerce

# Test ACO import (if ACO is available)
npm run import:aco
```

### 3. End-to-End Test

Full workflow:

```bash
# 1. Update source data
cd buildright-data
vi definitions/products/catalog.json  # Make a small change

# 2. Regenerate datapacks
cd ../commerce-demo-generator
npm run generate:all -- --data-repo=../buildright-data

# 3. Commit updated artifacts
cd ../buildright-data
git add generated/
git commit -m "Regenerate datapacks after product update"

# 4. Import to Commerce
cd ../commerce-demo-ingestion
npm run delete:commerce  # Clean slate
npm run import:commerce  # Fresh import

# 5. Verify in Commerce Admin
```

## Migration Benefits

✅ **Achieved:**
- Complete separation of concerns
- Generic, reusable tools
- Project-specific data isolated
- No cross-repo dependencies (in structure)
- Clean git history for each repo
- Independent versioning

⚠️ **Still Needed:**
- Code updates to use new structure
- Testing and validation
- Documentation updates
- CI/CD pipeline adjustments (if applicable)

## Next Steps

1. **Priority 1: Update generator scripts**
   - Start with `generate-commerce.js`
   - Test after each file update
   - Update related generator files

2. **Priority 2: Update ingestion scripts**
   - Start with config loader
   - Update import-all.js
   - Update individual importers

3. **Priority 3: Testing**
   - Generate fresh datapacks
   - Import to test Commerce instance
   - Verify all data imports correctly

4. **Priority 4: Documentation**
   - Update main README files
   - Add CONFIGURATION.md to generator
   - Add troubleshooting guides

## Rollback Plan

If issues arise, the original `buildright-commerce` repository is untouched and can still be used:

```bash
cd buildright-commerce
npm run generate
npm run import:commerce
```

## Questions / Decisions Needed

- [ ] Should we publish generator and ingestion as npm packages?
- [ ] What versioning strategy for data repositories?
- [ ] How to handle multiple data repos (citisignal, etc.)?
- [ ] CI/CD for auto-generation on data changes?
- [ ] Demo Builder extension integration timeline?

## Estimated Completion Time

- Generator updates: 4-6 hours
- Ingestion updates: 3-4 hours
- Testing: 2-3 hours
- Documentation: 1-2 hours
- **Total: 10-15 hours**

## Contact

For questions about this migration, refer to the plan document or contact the project maintainer.

