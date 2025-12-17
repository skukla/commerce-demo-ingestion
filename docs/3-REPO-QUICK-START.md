# 3-Repo Architecture Quick Start Guide

## Architecture Overview

```
┌─────────────────────────────┐
│  commerce-demo-generator    │  Generic tool
│  (Generates datapacks)      │
└────────────┬────────────────┘
             │
             ↓ reads from
┌─────────────────────────────┐
│     buildright-data         │  Project-specific
│  (Definitions + Generated)  │
└────────────┬────────────────┘
             │
             ↓ provides to
┌─────────────────────────────┐
│  commerce-demo-ingestion    │  Generic tool
│  (Imports to systems)       │
└────────────┬────────────────┘
             │
             ↓ imports to
┌──────────────┬──────────────┐
│   Commerce   │     ACO      │  Target systems
└──────────────┴──────────────┘
```

## Directory Structure

```
adobe-demo-system/
├── commerce-demo-generator/     # Tool: Generate datapacks
├── buildright-data/              # Data: BuildRight definitions + artifacts
├── commerce-demo-ingestion/     # Tool: Import to Commerce/ACO
├── buildright-commerce/          # Legacy: Keep for reference
└── buildright-aco/               # Legacy: Keep for ACO config
```

## For Data Maintainers (Updating BuildRight Demo)

### 1. Edit Source Data

```bash
cd buildright-data/definitions/
vi products/catalog.json          # Edit product definitions
vi categories/category-tree.json  # Edit category structure
# ... edit other files as needed
```

### 2. Regenerate Datapacks

```bash
cd ../commerce-demo-generator
npm install  # First time only
npm run generate:all -- --data-repo=../buildright-data
```

This creates:
- `buildright-data/generated/commerce/` - Commerce ACCS format
- `buildright-data/generated/aco/` - ACO format

### 3. Commit Changes

```bash
cd ../buildright-data
git add definitions/ generated/
git commit -m "Update product catalog - added new SKUs"
git push
```

## For Demo Deployers (Importing to Systems)

### 1. Get Latest Data

```bash
cd buildright-data
git pull
```

### 2. Configure Systems

```bash
cd ../commerce-demo-ingestion
cp .env.example .env
vi .env  # Add Commerce and ACO credentials
```

Example `.env`:
```env
DATA_REPO_PATH=../buildright-data
COMMERCE_BASE_URL=https://your-instance.com
COMMERCE_ADMIN_USERNAME=admin
COMMERCE_ADMIN_PASSWORD=your-password
ACO_API_KEY=your-key
```

### 3. Import to Commerce

```bash
npm install  # First time only
npm run import:commerce
```

### 4. Import to ACO (Optional)

```bash
npm run import:aco
```

## For Developers (Creating New Demo Projects)

### 1. Create New Data Repository

```bash
mkdir citisignal-data
cd citisignal-data

# Copy structure from buildright-data
cp -r ../buildright-data/definitions .
cp -r ../buildright-data/media .
mkdir -p generated/{commerce,aco}

# Edit definitions for your project
vi definitions/project.json
```

Example `definitions/project.json`:
```json
{
  "name": "CitiSignal",
  "displayName": "CitiSignal Demo",
  "identifier": "citisignal",
  "websiteCode": "citisignal",
  "storeCode": "citisignal_store",
  "storeViewCode": "citisignal_us",
  "rootCategoryName": "CitiSignal Catalog",
  "attributePrefix": "cs_",
  "customerAttributePrefix": "aco_"
}
```

### 2. Generate Datapacks

```bash
cd ../commerce-demo-generator
npm run generate:all -- --data-repo=../citisignal-data
```

### 3. Import to Systems

```bash
cd ../commerce-demo-ingestion

# Update .env with CitiSignal systems
vi .env  # Change COMMERCE_BASE_URL, etc.
export DATA_REPO_PATH=../citisignal-data

npm run import:commerce
npm run import:aco
```

## Common Commands

### Generator

```bash
cd commerce-demo-generator

# Generate Commerce datapack only
npm run generate:commerce -- --data-repo=../buildright-data

# Generate ACO format only
npm run generate:aco -- --data-repo=../buildright-data

# Generate both
npm run generate:all -- --data-repo=../buildright-data
```

### Ingestion

```bash
cd commerce-demo-ingestion

# Import to Commerce
npm run import:commerce

# Delete from Commerce
npm run delete:commerce

# Import to ACO
npm run import:aco

# Delete from ACO
npm run delete:aco
```

### Using Different Data Repos

```bash
# In generator
npm run generate:all -- --data-repo=../citisignal-data

# In ingestion
DATA_REPO_PATH=../citisignal-data npm run import:commerce
```

## Workflow Examples

### Scenario 1: Add New Products to BuildRight

```bash
# 1. Edit source data
cd buildright-data/definitions/products
vi catalog.json  # Add new products

# 2. Regenerate
cd ../../../commerce-demo-generator
npm run generate:all -- --data-repo=../buildright-data

# 3. Commit
cd ../buildright-data
git add . && git commit -m "Add 10 new products"

# 4. Import (optional - for testing)
cd ../commerce-demo-ingestion
npm run import:commerce
```

### Scenario 2: Fresh Install on New Commerce Instance

```bash
# 1. Get latest data
cd buildright-data
git pull

# 2. Configure new instance
cd ../commerce-demo-ingestion
vi .env  # Update Commerce URL and credentials

# 3. Import everything
npm run import:commerce
npm run import:aco
```

### Scenario 3: Reset Demo (Clean Slate)

```bash
cd commerce-demo-ingestion

# Delete all project data
npm run delete:commerce
npm run delete:aco

# Re-import fresh
npm run import:commerce
npm run import:aco
```

## Troubleshooting

### Generator Issues

**Problem:** Cannot find definitions files

**Solution:**
```bash
# Check data repo path
cd commerce-demo-generator
ls -la ../buildright-data/definitions/

# Verify DATA_REPO_PATH in .env or use CLI flag
npm run generate:commerce -- --data-repo=../buildright-data
```

### Ingestion Issues

**Problem:** Cannot connect to Commerce

**Solution:**
```bash
# Verify credentials in .env
cd commerce-demo-ingestion
cat .env | grep COMMERCE_

# Test connection manually
curl -u admin:password https://your-instance.com/rest/V1/store/websites
```

**Problem:** Products already exist

**Solution:**
```bash
# Delete first, then re-import
npm run delete:commerce
npm run import:commerce
```

## Benefits of This Architecture

✅ **For Data Maintainers:**
- Edit human-readable JSON files
- Version control definitions and artifacts together
- Easy to review changes in diffs

✅ **For Demo Deployers:**
- One command to import everything
- Idempotent (safe to re-run)
- Clear separation of data and tools

✅ **For Developers:**
- Generic tools work for any project
- Create new demos by copying data structure
- No code changes needed for new projects

## File Sizes

Typical sizes for reference:

- **commerce-demo-generator**: ~50 MB (with node_modules)
- **buildright-data**: ~2-5 MB (definitions + artifacts)
- **commerce-demo-ingestion**: ~30 MB (with node_modules)

## Git Workflow

```bash
# Data repositories (buildright-data, citisignal-data, etc.)
# Commit BOTH definitions and generated artifacts
git add definitions/ generated/
git commit -m "Update catalog"

# Tool repositories (generator, ingestion)
# Commit code only, not node_modules or output
git add scripts/ config/
git commit -m "Add new generator feature"
```

## Next Steps

1. **Read detailed READMEs** in each repository
2. **Review MIGRATION-STATUS.md** for remaining work
3. **Test the full workflow** with BuildRight data
4. **Create your own data repository** for new projects

## Support

- Generator issues: See `commerce-demo-generator/README.md`
- Ingestion issues: See `commerce-demo-ingestion/README.md`
- Data format questions: See `buildright-data/README.md`
- Migration questions: See `MIGRATION-STATUS.md`

